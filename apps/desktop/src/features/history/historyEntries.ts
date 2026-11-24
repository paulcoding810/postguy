import { toast } from 'sonner';
import { newId, type HttpMethod } from '@postguy/shared';
import { api, errorMessage } from '@/lib/api';
import { blankRequest, useTabs } from '@/stores/tabs';

export function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}


export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url.replace(/^https?:\/\/[^/]+/, '');
  }
}

/** Opens a sent request: its saved request if it still exists, otherwise a draft rebuilt from history. */
export async function openHistoryEntry(id: string) {
  try {
    const entry = await api('GET /history/:id', { params: { id } });
    if (entry.requestId) {
      try {
        const saved = await api('GET /requests/:id', { params: { id: entry.requestId } });
        useTabs.getState().openRequest(saved, { pin: true });
        return;
      } catch {
        /* request was deleted; fall back to a draft */
      }
    }
    const url = new URL(entry.url);
    const def = blankRequest(`${entry.method} ${url.pathname}`);
    def.method = entry.method as HttpMethod;
    def.url = `${url.origin}${url.pathname}`;
    def.params = [...url.searchParams.entries()].map(([key, value]) => ({
      id: newId(8),
      key,
      value,
      enabled: true,
    }));
    def.headers = Object.entries(entry.request.headers)
      .filter(([k]) => !/^content-type$/i.test(k) || !entry.request.body)
      .map(([key, value]) => ({ id: newId(8), key, value, enabled: true }));
    if (entry.request.body)
      def.body = {
        mode: /json/i.test(entry.request.headers['Content-Type'] ?? '') ? 'json' : 'text',
        raw: entry.request.body,
      };
    useTabs.getState().newRequest(null, def);
    toast.message('Restored as a new draft. Secret values were masked in history.');
  } catch (e) {
    toast.error(errorMessage(e));
  }
}
