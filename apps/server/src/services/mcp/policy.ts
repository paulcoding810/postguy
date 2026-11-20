import { MASK, redactText, resolveTemplate, type ResolvedRequest } from '@postguy/core';
import type { Environment } from '@postguy/shared';
import type { Db } from '../../db/client.ts';
import { HttpError } from '../../lib/errors.ts';
import { ancestry, getTree } from '../collections.ts';
import { buildContext } from '../context.ts';
import { activeEnvironment, getEnvironment, listEnvironments } from '../environments.ts';
import { getRequest } from '../requests.ts';
import { getMcpSettings } from '../settings.ts';
import { listVariables } from '../variables.ts';

export type Permission = 'read' | 'send' | 'edit';

export function requirePermission(db: Db, need: Permission) {
  const s = getMcpSettings(db);
  if (!s.enabled) throw new HttpError(403, 'Claude access is turned off in Postguy (Settings → Claude).', 'mcp_disabled');
  if (!s[need])
    throw new HttpError(403, `Postguy does not allow Claude to ${need === 'read' ? 'read the workspace' : need === 'send' ? 'send requests' : 'change the workspace'}; allow it in Settings → Claude.`, 'mcp_forbidden');
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

/** Secret values in scope that Claude must not see, except those of an environment that allows it. */
export function hiddenSecrets(db: Db, collectionId: string | null, environment: Environment | null): string[] {
  const reveal = environment?.mcpRevealSecrets ? environment.id : null;
  const scopes = [
    ...listEnvironments(db).filter((e) => e.id !== reveal).map((e) => ({ scope: e.kind === 'global' ? ('global' as const) : ('environment' as const), owner: e.id })),
    ...ancestry(db, collectionId).map((c) => ({ scope: 'collection' as const, owner: c.id })),
  ];
  return scopes.flatMap(({ scope, owner }) => listVariables(db, scope, owner, true).filter((v) => v.isSecret && v.value).map((v) => v.value));
}

/** Replaces secret values anywhere in a JSON-able value. */
export function mask<T>(value: T, secrets: string[]): T {
  if (!secrets.length) return value;
  return JSON.parse(redactText(JSON.stringify(value), secrets.map((s) => JSON.stringify(s).slice(1, -1)))) as T;
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

/** The send guard for Claude: secrets only travel to hosts the user already sends them to. */
export function secretHostGuard(db: Db, environmentId: string | null) {
  let known: Set<string> | null = null;
  return (request: ResolvedRequest, usedSecrets: string[]) => {
    if (!usedSecrets.length) return null;
    known ??= knownHosts(db, environmentId);
    const host = hostOf(request.url);
    if (host && known.has(host)) return null;
    return {
      code: 'MCP_SECRET_HOST_BLOCKED',
      message: `Not sent: this request would carry a secret to ${host ?? 'an unknown host'}, which none of your saved requests use. Send it from Postguy yourself if it is intended.`,
    };
  };
}

export { MASK, getEnvironment };
