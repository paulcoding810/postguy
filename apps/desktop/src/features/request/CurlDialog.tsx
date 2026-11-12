import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { openCurlInNewTab, useCurlDialog } from './curl';

export function CurlDialog() {
  const { open, setOpen } = useCurlDialog();
  const [text, setText] = React.useState('');
  React.useEffect(() => {
    if (open) setText('');
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-2xl">
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await openCurlInNewTab(text)) setOpen(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>Import cURL</DialogTitle>
            <DialogDescription>Paste a command, for example from your browser’s “Copy as cURL”. Bash, zsh and Windows cmd formats work.</DialogDescription>
          </DialogHeader>
          <Textarea autoFocus className="h-56 font-mono text-xs" placeholder="curl 'https://api.example.com/users' -H 'Accept: application/json'" value={text} onChange={(e) => setText(e.target.value)} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!text.trim()}>
              Import
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
