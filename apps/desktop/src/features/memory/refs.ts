export type Seg = string | number;

const SAFE_KEY = /^[A-Za-z_$][\w$-]*$/;

export function formatSegs(segs: Seg[]): string {
  let out = '';
  for (const s of segs) {
    if (typeof s === 'number') out += `[${s}]`;
    else if (s === '*') out += '[*]';
    else if (SAFE_KEY.test(s)) out += out ? `.${s}` : s;
    else out += `[${JSON.stringify(s)}]`;
  }
  return out;
}

/** Reference text for a value inside a remembered response, e.g. `Login.data.user.id`. */
export function refFor(name: string, path: string): string {
  if (/[.[\]{}]/.test(name)) return path ? `$res[${JSON.stringify(name)}].body${path.startsWith('[') ? '' : '.'}${path}` : `$res[${JSON.stringify(name)}].body`;
  if (!path) return name;
  return path.startsWith('[') ? `${name}${path}` : `${name}.${path}`;
}
