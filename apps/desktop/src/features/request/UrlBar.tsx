import { LoaderIcon, SaveIcon, SendIcon, XIcon } from 'lucide-react';
import { HTTP_METHODS, type HttpMethod } from '@postguy/shared';
import { Button } from '@/components/ui/button';
import { Kbd, Tooltip } from '@/components/ui/misc';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { applyUrlInput, displayUrl, syncPathParams } from '@/lib/url';
import { cn, modKey } from '@/lib/utils';
import { isDirty, useTabs, type RequestTab } from '@/stores/tabs';
import { TemplateInput } from '@/features/template/TemplateInput';
import { cancelSend, useSaveRequest, useSendRequest } from './actions';

export function UrlBar({ tab }: { tab: RequestTab }) {
  const updateDraft = useTabs((s) => s.updateDraft);
  const send = useSendRequest();
  const save = useSaveRequest();
  const { draft } = tab;

  const onUrl = (input: string) =>
    updateDraft(tab.id, (d) => {
      const { url, params } = applyUrlInput(input, d.params);
      return { ...d, url, params, pathParams: syncPathParams(url, d.pathParams) };
    });

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
          value={displayUrl(draft.url, draft.params)}
          onChange={onUrl}
          fieldLabel="URL"
          placeholder="Enter URL or paste text, e.g. {{baseUrl}}/users/:id"
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
      <Tooltip content={<span>Save <Kbd className="ml-1">{modKey}S</Kbd></span>}>
        <Button variant="outline" onClick={() => save(tab)} aria-label="Save request">
          <SaveIcon />
          {isDirty(tab) && <span className="size-1.5 rounded-full bg-primary" />}
        </Button>
      </Tooltip>
    </div>
  );
}
