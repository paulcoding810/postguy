import { authSecretValues, MASK, redactAuth, redactText, resolveTemplate, type ResolvedRequest } from '@postguy/core';
import type { Auth, Environment } from '@postguy/shared';
import { eq } from 'drizzle-orm';
import { collections, requests, variables } from '../../db/schema.ts';
import type { Db } from '../../db/client.ts';
import { HttpError } from '../../lib/errors.ts';
import { getTree } from '../collections.ts';
import { buildContext } from '../context.ts';
import { activeEnvironment, getEnvironment, listEnvironments } from '../environments.ts';
import { getRequest } from '../requests.ts';
import { getMcpSettings, untrustedHosts } from '../settings.ts';
import { listVariables } from '../variables.ts';

export type Permission = 'read' | 'send' | 'edit' | 'delete';

export function requirePermission(db: Db, need: Permission) {
  const s = getMcpSettings(db);
  if (!s.enabled) throw new HttpError(403, 'Claude access is turned off in Postguy (Settings → Claude).', 'mcp_disabled');
  const what = { read: 'read the workspace', send: 'send requests', edit: 'change the workspace', delete: 'delete requests or folders' }[need];
  if (!s[need] || (need === 'delete' && !s.edit)) throw new HttpError(403, `Postguy does not allow Claude to ${what}; allow it in Settings → Claude.`, 'mcp_forbidden');
}

/** The environment Claude asked for (by id or name), or the active one; never one the user blocked. */
export function environmentFor(db: Db, ref?: string | null): Environment | null {
  let env: Environment | null;
  if (ref) {
    env = listEnvironments(db).find((e) => e.id === ref || e.name.toLowerCase() === ref.toLowerCase()) ?? null;
    if (!env) throw new HttpError(404, `No environment "${ref}"`, 'not_found');
  } else env = activeEnvironment(db);
  if (env?.mcpBlocked) throw new HttpError(403, `The environment "${env.name}" is not available to Claude.`, 'mcp_environment_blocked');
  return env;
}

const MIN_LITERAL = 4;

/**
 * Values Claude must not see: every secret variable in any scope (except those of an environment
 * that allows it), and credentials typed straight into requests' or folders' auth.
 */
export function hiddenSecrets(db: Db, environment: Environment | null): string[] {
  const reveal = environment?.mcpRevealSecrets ? environment.id : null;
  const fromVars = db
    .select({ value: variables.value, scope: variables.scope, ownerId: variables.ownerId })
    .from(variables)
    .where(eq(variables.isSecret, true))
    .all()
    .filter((v) => v.value && !(v.scope === 'environment' && v.ownerId === reveal))
    .map((v) => v.value);
  const auths = [...db.select({ auth: requests.auth }).from(requests).all(), ...db.select({ auth: collections.auth }).from(collections).all()];
  const literal = auths.flatMap((a) => authSecretValues(a.auth)).filter((v) => v.length >= MIN_LITERAL && !v.includes('{{'));
  return [...new Set([...fromVars, ...literal])].sort((a, b) => b.length - a.length);
}

/** Replaces secret values inside the strings of a JSON-able value, and hides auth credentials. */
export function mask<T>(value: T, secrets: string[]): T {
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === 'string') return secrets.length ? redactText(v, secrets) : v;
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === 'object') {
      if (key === 'auth' && 'type' in v) return redactAuth(v as Auth);
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    }
    return v;
  };
  return walk(value) as T;
}

function hostOf(url: string): string | null {
  try {
    return new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(url) ? url : `http://${url}`).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Hosts a secret may go to when Claude sends: hosts of the user's saved requests and of URL-like
 * variables, resolved in the same environment. A request carrying a secret elsewhere is refused.
 */
export function knownHosts(db: Db, environmentId: string | null): Set<string> {
  const hosts = new Set<string>();
  const add = (u: string) => {
    const h = hostOf(u);
    if (h) hosts.add(h);
  };
  const walk = (nodes: ReturnType<typeof getTree>) => {
    for (const n of nodes) {
      const { ctx } = buildContext(db, { collectionId: n.id, requestId: null, environmentId });
      for (const r of n.requests) add(resolveTemplate(getRequest(db, r.id).url, ctx).value);
      for (const [, v] of ctx.variables) if (/^https?:\/\//i.test(v.value)) add(v.value);
      walk(n.children);
    }
  };
  walk(getTree(db));
  return hosts;
}

/** Hosts any environment's view of the workspace points at, to notice the ones an edit adds. */
export function allKnownHosts(db: Db): Set<string> {
  const out = new Set<string>();
  for (const id of [null, ...listEnvironments(db).filter((e) => e.kind !== 'global').map((e) => e.id)]) for (const h of knownHosts(db, id)) out.add(h);
  return out;
}

/** The send guard for Claude: secrets only travel to hosts the user already sends them to. */
export function secretHostGuard(db: Db, environmentId: string | null) {
  let known: Set<string> | null = null;
  return (request: ResolvedRequest, usedSecrets: string[]) => {
    if (!usedSecrets.length) return null;
    known ??= knownHosts(db, environmentId);
    const host = hostOf(request.url);
    if (host && known.has(host) && !untrustedHosts(db).has(host)) return null;
    return {
      code: 'MCP_SECRET_HOST_BLOCKED',
      message: `Not sent: this request would carry a secret to ${host ?? 'an unknown host'}, which none of your saved requests use. Send it from Postguy yourself if it is intended.`,
    };
  };
}

export { MASK, getEnvironment };
