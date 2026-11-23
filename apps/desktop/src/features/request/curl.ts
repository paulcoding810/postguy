import { toast } from 'sonner';
import { create } from 'zustand';
import type { CurlImportResult, RequestDefinition } from '@postguy/shared';
import { api, errorMessage } from '@/lib/api';
import { useTabs, type RequestTab } from '@/stores/tabs';

export const looksLikeCurl = (text: string) => /^\s*curl(\.exe)?\s/i.test(text);

export const useCurlDialog = create<{ open: boolean; setOpen: (v: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

function describe(r: CurlImportResult) {
  const lines = [
    r.variables.length ? `Used ${r.variables.map((v) => `{{${v}}}`).join(', ')} in place of the values pasted.` : '',
    r.warnings.length ? `${r.warnings.length} note${r.warnings.length > 1 ? 's' : ''}: ${r.warnings.join('; ')}` : '',
  ].filter(Boolean);
  return lines.length ? lines.join(' ') : undefined;
}

/** Replaces a tab's draft with a pasted cURL command; Undo restores the previous draft. */
export async function applyCurlToTab(tab: RequestTab, command: string) {
  try {
    const result = await api('POST /import/curl', { body: { command, collectionId: tab.collectionId, requestId: tab.requestId } });
    const previous = tab.draft;
    const fill = (request: RequestDefinition) => ({ ...request, name: tab.requestId ? previous.name : request.name, scripts: previous.scripts });
    useTabs.getState().updateDraft(tab.id, () => fill(result.request));
    const raw = result.raw;
    toast.success('Request filled from cURL', {
      description: describe(result),
      action: { label: 'Undo', onClick: () => useTabs.getState().updateDraft(tab.id, () => previous) },
      ...(raw && { cancel: { label: 'Keep raw values', onClick: () => useTabs.getState().updateDraft(tab.id, () => fill(raw)) } }),
    });
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

export async function openCurlInNewTab(command: string): Promise<boolean> {
  try {
    const result = await api('POST /import/curl', { body: { command } });
    const id = useTabs.getState().newRequest(null, result.request as RequestDefinition);
    const raw = result.raw;
    toast.success('Imported cURL as a new request', {
      description: describe(result),
      ...(raw && { action: { label: 'Keep raw values', onClick: () => useTabs.getState().updateDraft(id, () => raw) } }),
    });
    return true;
  } catch (e) {
    toast.error(errorMessage(e));
    return false;
  }
}

export async function copyAsCurl(tab: RequestTab, as: 'curl' | 'fetch' = 'curl') {
  const what = as === 'curl' ? 'cURL' : 'fetch';
  try {
    const r = await api(as === 'curl' ? 'POST /export/curl' : 'POST /export/fetch', { body: { request: tab.draft, collectionId: tab.collectionId, requestId: tab.requestId } });
    await navigator.clipboard.writeText(r.command);
    if (r.unresolved.length) toast.warning('Copied, but some references are unresolved', { description: r.unresolved.map((u) => `{{${u}}}`).join(', ') });
    else if (r.containsSecrets) toast.warning(`Copied as ${what}`, { description: 'It contains secret values such as tokens or passwords. Share it with care.' });
    else toast.success(`Copied as ${what}`);
  } catch (e) {
    toast.error(errorMessage(e));
  }
}
