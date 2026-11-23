import * as React from 'react';
import { BracesIcon, ChevronDownIcon, LoaderIcon, SaveIcon, SendIcon, TerminalIcon, XIcon } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/menu';
import { applyCurlToTab, copyAsCurl, looksLikeCurl, useCurlDialog } from './curl';
import { HTTP_METHODS, type HttpMethod } from '@postguy/shared';
import { Button } from '@/components/ui/button';
import { Kbd, Tooltip } from '@/components/ui/misc';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { applyUrlInput, syncPathParams, urlBarText } from '@/lib/url';
import { cn, modKey } from '@/lib/utils';
import { isDirty, useTabs, type RequestTab } from '@/stores/tabs';
import { TemplateInput } from '@/features/template/TemplateInput';
import { cancelSend, useSaveRequest, useSendRequest } from './actions';

export function UrlBar({ tab }: { tab: RequestTab }) {
  const updateDraft = useTabs((s) => s.updateDraft);
  const send = useSendRequest();
  const save = useSaveRequest();
  const { draft } = tab;
  const [typed, setTyped] = React.useState<string | null>(null);
  React.useEffect(() => setTyped(null), [tab.id]);

  const onUrl = (input: string) => {
    setTyped(input);
    updateDraft(tab.id, (d) => {
      const { url, params } = applyUrlInput(input, d.params);
      return { ...d, url, params, pathParams: syncPathParams(url, d.pathParams) };
    });
  };

  return (
    <div className="flex items-center gap-2 p-3">
      <div className="flex min-w-0 flex-1 items-center rounded-md border shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30 dark:bg-input/30">
        <Select value={draft.method} onValueChange={(m) => updateDraft(tab.id, (d) => ({ ...d, method: m as HttpMethod }))}>
          <SelectTrigger
            aria-label="HTTP method"
            className={cn('w-[104px] shrink-0 rounded-r-none border-0 border-r font-mono font-semibold shadow-none dark:bg-transparent', `method-${draft.method}`)}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="w-[120px]">
            {HTTP_METHODS.map((m) => (
              <SelectItem key={m} value={m} className={cn('font-mono font-semibold', `method-${m}`)}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <TemplateInput
          className="flex-1"
          borderless
          inputClassName="font-mono text-[12.5px]"
          value={urlBarText(typed, draft.url, draft.params)}
          onChange={onUrl}
          fieldLabel="URL"
          placeholder="Enter a URL or paste a cURL command, e.g. {{baseUrl}}/users/:id"
          onPaste={(e) => {
            const text = e.clipboardData.getData('text');
            if (!looksLikeCurl(text)) return;
            e.preventDefault();
            void applyCurlToTab(tab, text);
          }}
          onEnter={(e) => {
            e.preventDefault();
            void send(tab);
          }}
        />
      </div>
      {tab.sending ? (
        <Button variant="secondary" onClick={() => cancelSend(tab.id)} className="w-24">
          <LoaderIcon className="animate-spin" /> Cancel
          <XIcon className="hidden" />
        </Button>
      ) : (
        <Tooltip content={<span>Send <Kbd className="ml-1">{modKey}↵</Kbd></span>}>
          <Button onClick={() => send(tab)} className="w-24">
            <SendIcon /> Send
          </Button>
        </Tooltip>
      )}
      <div className="flex">
        <Tooltip content={<span>Save <Kbd className="ml-1">{modKey}S</Kbd></span>}>
          <Button variant="outline" className="rounded-r-none" onClick={() => save(tab)} aria-label="Save request">
            <SaveIcon />
            {isDirty(tab) && <span className="size-1.5 rounded-full bg-primary" />}
          </Button>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="-ml-px w-7 rounded-l-none" aria-label="More request actions">
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => save(tab, { saveAs: true })}>
              <SaveIcon /> Save as…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => copyAsCurl(tab)}>
              <TerminalIcon /> Copy as cURL
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => copyAsCurl(tab, 'fetch')}>
              <BracesIcon /> Copy as fetch
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => useCurlDialog.getState().setOpen(true)}>
              <TerminalIcon /> Import cURL…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
