import type { ExportedCollection } from '@postguy/shared';
import { DYNAMIC_VARIABLES } from '../template/dynamic.ts';

const SCRIPT_FEATURES: { pattern: RegExp; what: string }[] = [
  { pattern: /\bpm\.sendRequest\s*\(/, what: 'pm.sendRequest (chain the requests in a flow instead)' },
  { pattern: /\b(?:postman\.setNextRequest|pm\.execution\.setNextRequest)\s*\(/, what: 'setNextRequest (use flow conditions instead)' },
  { pattern: /\bpm\.execution\b/, what: 'pm.execution' },
  { pattern: /\bpm\.vault\b/, what: 'pm.vault' },
  { pattern: /\bpm\.visualizer\b/, what: 'pm.visualizer' },
  { pattern: /\bpm\.iterationData\b/, what: 'pm.iterationData' },
  { pattern: /\bCryptoJS\.(?:AES|DES|TripleDES|Rabbit|RC4|PBKDF2)\b/, what: 'CryptoJS ciphers (hashes, HMAC and encoders work)' },
  { pattern: /\brequire\s*\(\s*['"](?!crypto-js['"])[^'"]+['"]\s*\)/, what: "require() of modules other than 'crypto-js'" },
  { pattern: /(?:^|[^\w$.])_\.\w+\s*\(/m, what: 'lodash (_)' },
  { pattern: /\b(?:xml2Json|cheerio|tv4)\b/, what: 'xml2Json, cheerio or tv4' },
];

const KNOWN = new Set(DYNAMIC_VARIABLES);
const DYNAMIC_REF = /\{\{\s*(\$[A-Za-z][\w]*)\s*\}\}/g;

function list(names: string[]): string {
  const shown = names.slice(0, 3).map((n) => `"${n}"`).join(', ');
  return names.length > 3 ? `${shown} and ${names.length - 3} more` : shown;
}

/** Lists features in an imported collection that Postguy will not run, grouped with the requests that use them. */
export function compatibilityWarnings(root: ExportedCollection): string[] {
  const byFeature = new Map<string, string[]>();
  const unknownVars = new Map<string, string[]>();
  const note = (map: Map<string, string[]>, key: string, request: string) => {
    const names = map.get(key) ?? [];
    if (!names.includes(request)) names.push(request);
    map.set(key, names);
  };
  const walk = (node: ExportedCollection, path: string) => {
    for (const r of node.requests) {
      const name = path ? `${path} / ${r.name}` : r.name;
      const script = `${r.scripts?.pre ?? ''}\n${r.scripts?.post ?? ''}`;
      for (const f of SCRIPT_FEATURES) if (f.pattern.test(script)) note(byFeature, f.what, name);
      const { scripts: _scripts, ...rest } = r;
      for (const m of JSON.stringify(rest).matchAll(DYNAMIC_REF)) if (!KNOWN.has(m[1]!)) note(unknownVars, m[1]!, name);
    }
    for (const f of node.folders) walk(f, path ? `${path} / ${f.name}` : f.name);
  };
  walk(root, '');
  return [
    ...[...byFeature].map(([what, names]) => `Scripts use ${what}, which Postguy doesn't run: ${list(names)}.`),
    ...[...unknownVars].map(([v, names]) => `{{${v}}} isn't a built-in variable Postguy knows, so it is sent as text: ${list(names)}.`),
  ];
}
