import type { ChangeEntry, KeyValue } from '@postguy/shared';

type Obj = Record<string, any>;

const pairs = (title: string, list: KeyValue[] | undefined) =>
  list?.length ? [`${title}:`, ...list.map((p) => `  ${p.enabled === false ? '(off) ' : ''}${p.key} = ${p.value}`)] : [];

function auth(a: Obj | undefined): string[] {
  if (!a || a.type === 'inherit') return ['Auth: inherit'];
  if (a.type === 'none') return ['Auth: none'];
  const fields = Object.entries(a)
    .filter(([k, v]) => k !== 'type' && v !== undefined && v !== '' && typeof v !== 'object')
    .map(([k, v]) => `  ${k} = ${v}`);
  return [`Auth: ${a.type}`, ...fields];
}

function scripts(s: Obj | undefined): string[] {
  const out: string[] = [];
  if (s?.pre?.trim()) out.push('Pre-request script:', ...s.pre.trimEnd().split('\n').map((l: string) => `  ${l}`));
  if (s?.post?.trim()) out.push('Post-response script:', ...s.post.trimEnd().split('\n').map((l: string) => `  ${l}`));
  return out;
}

const variables = (list: Obj[] | undefined) =>
  list?.length ? ['Variables:', ...list.map((v) => `  ${v.enabled === false ? '(off) ' : ''}${v.key} = ${v.value}${v.isSecret ? ' (secret)' : ''}`)] : [];

/** A readable text form of one side of a change, for diffing. */
export function changeText(entry: ChangeEntry, side: 'before' | 'after'): string {
  const snap = entry[side] as Obj | null;
  if (!snap) return '';
  if (entry.entityType === 'variables' || entry.entityType === 'environment') return variables(snap as Obj[]).join('\n') || '(no variables)';
  if (entry.entityType === 'active-environment') return `Active environment: ${(snap as Obj).name}`;
  if (entry.entityType === 'request') {
    const r = snap.request as Obj;
    const body = r.body as Obj | undefined;
    return [
      `${r.method} ${r.url}`,
      `Name: ${r.name}`,
      ...(r.description ? [`Description: ${r.description}`] : []),
      ...pairs('Params', r.params),
      ...pairs('Path variables', r.pathParams),
      ...pairs('Headers', r.headers),
      ...auth(r.auth),
      ...(body && body.mode !== 'none'
        ? [
            `Body (${body.mode}):`,
            ...(body.raw ? body.raw.split('\n').map((l: string) => `  ${l}`) : []),
            ...(body.operationName ? [`  Operation: ${body.operationName}`] : []),
            ...(body.variables?.trim() ? ['  Variables:', ...body.variables.split('\n').map((l: string) => `    ${l}`)] : []),
            ...pairs('  Fields', body.form),
          ]
        : []),
      ...scripts(snap.scripts),
      ...variables(snap.variables),
      ...(snap.examples?.length ? ['Examples:', ...snap.examples.map((e: Obj) => `  ${e.name}${e.status ? ` (${e.status})` : ''}`)] : []),
    ].join('\n');
  }
  const c = snap.collection as Obj;
  const lines = [`Name: ${c.name}`, ...(c.description ? [`Description: ${c.description}`] : []), ...auth(c.auth), ...scripts(snap.scripts), ...variables(snap.variables)];
  const count = (s: Obj): number => (s.requests?.length ?? 0) + (s.folders ?? []).reduce((n: number, f: Obj) => n + count(f), 0);
  if (snap.requests || snap.folders) lines.push(`Contained ${count(snap)} request(s) in ${(snap.folders ?? []).length} folder(s)`);
  return lines.join('\n');
}
