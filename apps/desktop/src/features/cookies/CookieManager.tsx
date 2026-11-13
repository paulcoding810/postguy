import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CookieIcon, Trash2Icon } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { create } from 'zustand';
import type { JarCookie } from '@postguy/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/misc';
import { useEnvironments } from '@/hooks/queries';
import { api, errorMessage } from '@/lib/api';

export const cookieKeys = { all: ['cookies'] as const };

export const useCookieManager = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

function expiry(c: JarCookie): string {
  return c.expiresAt === null ? 'Session' : new Date(c.expiresAt).toLocaleString();
}

/** Cookies the jar sends on later requests, grouped by environment and domain. */
export function CookieManager() {
  const { open, setOpen } = useCookieManager();
  const qc = useQueryClient();
  const cookies = useQuery({ queryKey: cookieKeys.all, queryFn: () => api('GET /cookies'), enabled: open });
  const envs = useEnvironments();
  const envName = (id: string | null) => (id ? (envs.data?.find((e) => e.id === id)?.name ?? 'Deleted environment') : 'No environment');

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: cookieKeys.all });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const groups = React.useMemo(() => {
    const out = new Map<string, { environmentId: string | null; domain: string; cookies: JarCookie[] }>();
    for (const c of cookies.data ?? []) {
      const key = `${c.environmentId ?? ''} ${c.domain}`;
      if (!out.has(key)) out.set(key, { environmentId: c.environmentId, domain: c.domain, cookies: [] });
      out.get(key)!.cookies.push(c);
    }
    return [...out.values()];
  }, [cookies.data]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Cookies</DialogTitle>
          <DialogDescription>
            Cookies from responses are sent on later requests to the same site, per environment. A request that sets its own Cookie header, or turns
            cookies off in Settings, skips the jar.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto">
          {!groups.length ? (
            <EmptyState icon={<CookieIcon className="size-6" />} title="No cookies">
              Send a request that sets a cookie and it appears here.
            </EmptyState>
          ) : (
            groups.map((g) => (
              <section key={`${g.environmentId} ${g.domain}`} className="mb-3 rounded-md border">
                <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs">
                  <span className="font-mono font-medium">{g.domain}</span>
                  <span className="text-muted-foreground">{envName(g.environmentId)}</span>
                  <Button
                    size="xs"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => run(() => api('DELETE /cookies', { query: { environmentId: g.environmentId ?? '', domain: g.domain } }))}
                  >
                    Clear domain
                  </Button>
                </div>
                <table className="w-full text-xs">
                  <tbody className="font-mono">
                    {g.cookies.map((c) => (
                      <tr key={c.id} className="group border-b last:border-b-0">
                        <td className="px-3 py-1.5">{c.name}</td>
                        <td className="max-w-72 truncate px-3 py-1.5 select-text" title={c.value}>
                          {c.value}
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">{c.path}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{expiry(c)}</td>
                        <td className="w-8 px-1">
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            className="opacity-0 group-hover:opacity-100"
                            aria-label={`Delete ${c.name}`}
                            onClick={() => run(() => api('DELETE /cookies/:id', { params: { id: c.id } }))}
                          >
                            <Trash2Icon className="size-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))
          )}
        </div>
        {groups.length > 0 && (
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => run(() => api('DELETE /cookies', { query: {} }))}>
              <Trash2Icon /> Clear all cookies
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
