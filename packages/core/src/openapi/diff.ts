import { create } from 'jsondiffpatch';
import type { ApiModel, OpenApiOperation } from '@postguy/shared';

const patcher = create({
  objectHash: (obj: object, index?: number) => {
    const o = obj as Record<string, unknown>;
    if (typeof o.name === 'string' && typeof o.in === 'string') return `${o.in}:${o.name}`;
    if (typeof o.status === 'string') return `status:${o.status}`;
    return `$$index:${index}`;
  },
  arrays: { detectMove: false },
});

export interface OperationChange {
  key: string;
  method: string;
  path: string;
  summary?: string;
  /** Human-readable list of what changed, e.g. "query param limit added". */
  changes: string[];
  before: OpenApiOperation;
  after: OpenApiOperation;
}

export interface SpecDiff {
  added: OpenApiOperation[];
  removed: OpenApiOperation[];
  changed: OperationChange[];
  unchanged: number;
  servers: { before: string[]; after: string[] } | null;
  info: { before: string; after: string } | null;
}

export const operationKey = (op: Pick<OpenApiOperation, 'method' | 'path'>) =>
  `${op.method} ${op.path.replace(/\{[^}]+\}/g, '{}')}`;

function describe(before: OpenApiOperation, after: OpenApiOperation): string[] {
  const out: string[] = [];
  const params = (op: OpenApiOperation) => new Map(op.params.map((p) => [`${p.in}:${p.name}`, p]));
  const pb = params(before);
  const pa = params(after);
  for (const [k, p] of pa) {
    const old = pb.get(k);
    if (!old) out.push(`${p.in} param ${p.name} added${p.required ? ' (required)' : ''}`);
    else {
      if (old.required !== p.required) out.push(`${p.in} param ${p.name} is now ${p.required ? 'required' : 'optional'}`);
      if (patcher.diff(old.schema ?? {}, p.schema ?? {})) out.push(`${p.in} param ${p.name} schema changed`);
    }
  }
  for (const [k, p] of pb) if (!pa.has(k)) out.push(`${p.in} param ${p.name} removed`);
  if (!before.requestBody && after.requestBody) out.push('request body added');
  else if (before.requestBody && !after.requestBody) out.push('request body removed');
  else if (before.requestBody && after.requestBody) {
    if (before.requestBody.contentType !== after.requestBody.contentType) out.push(`request content type is now ${after.requestBody.contentType}`);
    if (patcher.diff(before.requestBody.schema ?? {}, after.requestBody.schema ?? {})) out.push('request body schema changed');
  }
  const rb = new Map(before.responses.map((r) => [r.status, r]));
  const ra = new Map(after.responses.map((r) => [r.status, r]));
  for (const [s, r] of ra) {
    const old = rb.get(s);
    if (!old) out.push(`response ${s} added`);
    else if (patcher.diff(old.schema ?? {}, r.schema ?? {})) out.push(`response ${s} schema changed`);
  }
  for (const s of rb.keys()) if (!ra.has(s)) out.push(`response ${s} removed`);
  if (patcher.diff(before.security, after.security)) out.push(`security is now ${after.security.join(', ') || 'none'}`);
  if ((before.summary ?? '') !== (after.summary ?? '')) out.push('summary changed');
  if ((before.description ?? '') !== (after.description ?? '')) out.push('description changed');
  if (!!before.deprecated !== !!after.deprecated) out.push(after.deprecated ? 'deprecated' : 'no longer deprecated');
  if (patcher.diff(before.tags, after.tags)) out.push(`tags are now ${after.tags.join(', ') || 'none'}`);
  if (before.id !== after.id) out.push(`operationId ${before.id} → ${after.id}`);
  return out;
}

/** Compares two specs operation by operation (matched by method and path template). */
export function diffSpecs(before: ApiModel, after: ApiModel): SpecDiff {
  const b = new Map(before.operations.map((o) => [operationKey(o), o]));
  const a = new Map(after.operations.map((o) => [operationKey(o), o]));
  const added: OpenApiOperation[] = [];
  const removed: OpenApiOperation[] = [];
  const changed: OperationChange[] = [];
  let unchanged = 0;
  for (const [k, op] of a) {
    const old = b.get(k);
    if (!old) {
      added.push(op);
      continue;
    }
    const changes = describe(old, op);
    if (changes.length) changed.push({ key: k, method: op.method, path: op.path, summary: op.summary, changes, before: old, after: op });
    else unchanged++;
  }
  for (const [k, op] of b) if (!a.has(k)) removed.push(op);
  const sb = before.servers.map((s) => s.url);
  const sa = after.servers.map((s) => s.url);
  return {
    added,
    removed,
    changed,
    unchanged,
    servers: JSON.stringify(sb) === JSON.stringify(sa) ? null : { before: sb, after: sa },
    info: before.version === after.version ? null : { before: before.version, after: after.version },
  };
}
