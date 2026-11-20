import * as React from 'react';
import { api, ApiError, CLIENT_ID } from '@/lib/api';
import { streamEvents } from '@/lib/sse';
import { isDirty, isRequestTab, useTabs } from '@/stores/tabs';
import { queryClient } from './queries';

/** Brings open, unedited request tabs up to date with the saved request; closes tabs whose request is gone. */
async function refreshCleanTabs() {
  for (const tab of useTabs.getState().tabs) {
    if (!isRequestTab(tab) || !tab.requestId || isDirty(tab)) continue;
    try {
      const saved = await api('GET /requests/:id', { params: { id: tab.requestId } });
      const now = useTabs.getState().tabs.find((t) => t.id === tab.id);
      if (isRequestTab(now) && !isDirty(now)) useTabs.getState().markSaved(tab.id, saved);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) useTabs.getState().onRequestDeleted(tab.requestId);
    }
  }
}

/**
 * Listens for workspace changes made outside this window (Claude over MCP, scripts using the API,
 * another window) and reloads what they may have touched. Open flow graphs are left alone: the
 * editor holds their unsaved state.
 */
export function useLiveChanges() {
  React.useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'flow' });
        void refreshCleanTabs();
      }, 250);
    };
    void (async () => {
      for (let delay = 1000; !controller.signal.aborted; delay = Math.min(delay * 2, 15_000)) {
        try {
          await streamEvents(
            '/events',
            (event, data) => {
              delay = 1000;
              if (event === 'change' && (data as { origin: string | null }).origin !== CLIENT_ID) refresh();
            },
            controller.signal,
          );
        } catch {
          /* server restarting or unreachable; retry below */
        }
        await new Promise((r) => setTimeout(r, delay));
      }
    })();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, []);
}
