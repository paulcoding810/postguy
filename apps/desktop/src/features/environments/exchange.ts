import type { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Environment } from '@postguy/shared';
import { keys } from '@/hooks/queries';
import { api, errorMessage } from '@/lib/api';
import { showImportNotes } from '@/lib/importNotes';
import { downloadJson, pickFile } from '@/features/collections/transfer';

export function looksLikePostmanEnvironment(data: unknown): boolean {
  const d = data as Record<string, unknown> | null;
  return !!d && typeof d === 'object' && Array.isArray(d.values) && !('info' in d);
}

/** Imports already-parsed Postman environment JSON and reports what happened. */
export async function importEnvironmentData(qc: QueryClient, data: unknown): Promise<Environment | null> {
  try {
    const { environment, warnings } = await api('POST /environments/import', { body: { data } });
    await qc.invalidateQueries({ queryKey: keys.environments });
    qc.invalidateQueries({ queryKey: ['variables'] });
    toast.success(environment.kind === 'global' ? 'Imported Postman globals' : `Imported environment "${environment.name}"`);
    showImportNotes(warnings);
    return environment;
  } catch (e) {
    toast.error(errorMessage(e));
    return null;
  }
}

export async function importEnvironmentFile(qc: QueryClient): Promise<Environment | null> {
  const file = await pickFile('.json,application/json');
  if (!file) return null;
  let data: unknown;
  try {
    data = JSON.parse(file.text);
  } catch {
    toast.error(`${file.name} is not valid JSON`);
    return null;
  }
  return importEnvironmentData(qc, data);
}

export async function exportEnvironment(env: Environment) {
  try {
    const data = await api('GET /environments/:id/export', { params: { id: env.id } });
    await downloadJson(`${env.kind === 'global' ? 'globals' : env.name}.postman_environment.json`, data);
    if (data.values.some((v) => v.type === 'secret')) toast.message('Secret values were left blank in the file.');
  } catch (e) {
    toast.error(errorMessage(e));
  }
}
