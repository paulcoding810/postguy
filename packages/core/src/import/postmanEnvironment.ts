type Obj = Record<string, any>;

export interface ImportedEnvironment {
  name: string;
  /** Postman globals go into Postguy's global environment. */
  scope: 'environment' | 'globals';
  variables: { key: string; value: string; isSecret: boolean; enabled: boolean }[];
}

export function isPostmanEnvironment(data: unknown): boolean {
  const d = data as Obj | null;
  return !!d && typeof d === 'object' && Array.isArray(d.values) && !d.info && (typeof d._postman_variable_scope === 'string' || typeof d.name === 'string');
}

export function postmanToEnvironment(data: unknown): ImportedEnvironment {
  const d = data as Obj;
  const byKey = new Map<string, ImportedEnvironment['variables'][number]>();
  const env: ImportedEnvironment = {
    name: typeof d.name === 'string' && d.name.trim() ? d.name.trim() : 'Imported environment',
    scope: d._postman_variable_scope === 'globals' ? 'globals' : 'environment',
    variables: (d.values as Obj[])
      .filter((v) => v && typeof v.key === 'string' && v.key)
      .map((v) => ({
        key: v.key,
        value: v.value === undefined || v.value === null ? '' : typeof v.value === 'string' ? v.value : JSON.stringify(v.value),
        isSecret: v.type === 'secret',
        enabled: v.enabled !== false,
      })),
  };
  for (const v of env.variables) byKey.set(v.key, v);
  return { ...env, variables: [...byKey.values()] };
}

/** Postman's environment format, which Postman and Postguy both import. Secret values are left blank. */
export function environmentToPostman(
  env: { id: string; name: string; kind: 'global' | 'environment' },
  variables: { key: string; value: string; isSecret: boolean; enabled: boolean }[],
) {
  return {
    id: env.id,
    name: env.name,
    values: variables.map((v) => ({ key: v.key, value: v.isSecret ? '' : v.value, type: v.isSecret ? 'secret' : 'default', enabled: v.enabled })),
    _postman_variable_scope: env.kind === 'global' ? 'globals' : 'environment',
    _postman_exported_at: new Date().toISOString(),
    _postman_exported_using: 'Postguy',
  };
}
