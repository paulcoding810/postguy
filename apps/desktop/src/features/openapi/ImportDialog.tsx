import { useQueryClient } from '@tanstack/react-query';
import { FileUpIcon, LoaderIcon } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { create } from 'zustand';
import type { OpenApiSourceType } from '@postguy/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Label, Textarea } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { keys } from '@/hooks/queries';
import { api, errorMessage } from '@/lib/api';
import { showImportNotes } from '@/lib/importNotes';
import { useUi } from '@/stores/ui';
import { pickFile } from '@/features/collections/transfer';

export const useImportDialog = create<{ open: boolean; setOpen: (v: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

export function OpenApiImportDialog() {
  const { open, setOpen } = useImportDialog();
  const qc = useQueryClient();
  const [mode, setMode] = React.useState<OpenApiSourceType>('file');
  const [content, setContent] = React.useState('');
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [url, setUrl] = React.useState('');
  const [name, setName] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setContent('');
      setFileName(null);
      setUrl('');
      setName('');
    }
  }, [open]);

  const choose = async () => {
    const f = await pickFile('.json,.yaml,.yml,.har,application/json,application/yaml');
    if (f) {
      setContent(f.text);
      setFileName(f.name);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api('POST /openapi/import', {
        body: mode === 'url' ? { sourceType: 'url', url, name: name || undefined } : { sourceType: mode, content, name: name || undefined },
      });
      await Promise.all([qc.invalidateQueries({ queryKey: keys.tree }), qc.invalidateQueries({ queryKey: ['openapi'] })]);
      const what = res.kind === 'postman' ? 'Postman collection' : res.kind === 'postguy' ? 'collection' : res.kind === 'har' ? 'HAR recording' : 'spec';
      toast.success(`Imported ${res.requestCount} requests from the ${what} "${res.name}"`);
      showImportNotes(res.warnings);
      useUi.getState().setSidebar('collections');
      setOpen(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const ready = mode === 'url' ? /^https?:\/\//.test(url) : content.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Import</DialogTitle>
            <DialogDescription>
              OpenAPI 3.0, 3.1 and Swagger 2.0 in JSON or YAML, grouped into folders by tag. Postman (v2.0, v2.1) and Postguy collection exports work here too, and so
              do HAR recordings (DevTools → Network → Save all as HAR): their API calls become requests.
            </DialogDescription>
          </DialogHeader>
          <Tabs value={mode} onValueChange={(v) => setMode(v as OpenApiSourceType)}>
            <TabsList className="px-0">
              <TabsTrigger value="file">Upload file</TabsTrigger>
              <TabsTrigger value="paste">Paste</TabsTrigger>
              <TabsTrigger value="url">From URL</TabsTrigger>
            </TabsList>
            <TabsContent value="file" className="pt-3">
              <button
                type="button"
                onClick={choose}
                className="flex h-32 w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed text-muted-foreground hover:border-ring hover:text-foreground"
              >
                <FileUpIcon className="size-6" />
                {fileName ? <span className="font-medium text-foreground">{fileName}</span> : 'Choose a .json, .yaml, .yml or .har file'}
              </button>
            </TabsContent>
            <TabsContent value="paste" className="pt-3">
              <Textarea
                className="h-56 font-mono text-xs"
                placeholder="openapi: 3.0.3&#10;info: …"
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </TabsContent>
            <TabsContent value="url" className="pt-3">
              <Input placeholder="https://example.com/openapi.yaml" value={url} onChange={(e) => setUrl(e.target.value)} />
              <p className="mt-1.5 text-xs text-muted-foreground">External $ref files are not followed for safety.</p>
            </TabsContent>
          </Tabs>
          <div className="grid gap-1.5">
            <Label>Collection name (optional)</Label>
            <Input placeholder="Defaults to the API title" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready || busy}>
              {busy && <LoaderIcon className="animate-spin" />} Import
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
