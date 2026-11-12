import { toast } from 'sonner';
import { create } from 'zustand';
import type { RequestDefinition } from '@postguy/shared';
import { api, errorMessage } from '@/lib/api';
import { useTabs, type RequestTab } from '@/stores/tabs';

export const looksLikeCurl = (text: string) => /^\s*curl(\.exe)?\s/i.test(text);

export const useCurlDialog = create<{ open: boolean; setOpen: (v: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

function warn(warnings: string[]) {
  return warnings.length ? `${warnings.length} note${warnings.length > 1 ? 's' : ''}: ${warnings.join('; ')}` : undefined;
}

/** Replaces a tab's draft with a pasted cURL command; Undo restores the previous draft. */
export async function applyCurlToTab(tab: RequestTab, command: string) {
  try {
    const { request, warnings } = await api('POST /import/curl', { body: { command } });
    const previous = tab.draft;
    const name = tab.requestId ? previous.name : request.name;
    useTabs.getState().updateDraft(tab.id, () => ({ ...request, name, scripts: previous.scripts }));
    toast.success('Request filled from cURL', {
      description: warn(warnings),
      action: { label: 'Undo', onClick: () => useTabs.getState().updateDraft(tab.id, () => previous) },
    });
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

export async function openCurlInNewTab(command: string): Promise<boolean> {
  try {
    const { request, warnings } = await api('POST /import/curl', { body: { command } });
    useTabs.getState().newRequest(null, request as RequestDefinition);
    toast.success('Imported cURL as a new request', { description: warn(warnings) });
    return true;
  } catch (e) {
    toast.error(errorMessage(e));
    return false;
  }
}

export async function copyAsCurl(tab: RequestTab) {
  try {
    const r = await api('POST /export/curl', { body: { request: tab.draft, collectionId: tab.collectionId, requestId: tab.requestId } });
    await navigator.clipboard.writeText(r.command);
    if (r.unresolved.length) toast.warning('Copied, but some references are unresolved', { description: r.unresolved.map((u) => `{{${u}}}`).join(', ') });
    else if (r.containsSecrets) toast.warning('Copied as cURL', { description: 'It contains secret values such as tokens or passwords. Share it with care.' });
    else toast.success('Copied as cURL');
  } catch (e) {
    toast.error(errorMessage(e));
  }
}
