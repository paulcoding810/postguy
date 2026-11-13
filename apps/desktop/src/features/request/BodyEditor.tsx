import { WandSparklesIcon } from 'lucide-react';
import { toast } from 'sonner';
import { BODY_MODES, type Body } from '@postguy/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CodeEditor } from '@/components/CodeEditor';
import { FilePathField } from './FilePathField';
import { KeyValueEditor } from './KeyValueEditor';

const MODE_LABELS: Record<Body['mode'], string> = {
  none: 'none',
  json: 'JSON',
  text: 'Text',
  form: 'form-data',
  urlencoded: 'x-www-form-urlencoded',
  binary: 'binary',
};

/** Pretty-prints JSON while leaving unquoted {{refs}} intact. */
export function beautifyJson(raw: string): string {
  const placeholders: string[] = [];
  const masked = raw.replace(/(?<!")\{\{[^{}]+\}\}(?!")/g, (m) => {
    placeholders.push(m);
    return `"__PG_REF_${placeholders.length - 1}__"`;
  });
  const pretty = JSON.stringify(JSON.parse(masked), null, 2);
  return pretty.replace(/"__PG_REF_(\d+)__"/g, (_, i: string) => placeholders[Number(i)]!);
}

export function BodyEditor({ body, onChange, editorPath }: { body: Body; onChange: (b: Body) => void; editorPath: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b px-3 py-1.5">
        {BODY_MODES.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onChange({ ...body, mode: m, form: body.form ?? [] })}
            className={cn(
              'rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground',
              body.mode === m && 'bg-secondary font-medium text-foreground',
            )}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
        {body.mode === 'json' && (
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto"
            onClick={() => {
              try {
                onChange({ ...body, raw: beautifyJson(body.raw ?? '') });
              } catch {
                toast.error('Body is not valid JSON');
              }
            }}
          >
            <WandSparklesIcon /> Beautify
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {body.mode === 'none' && <p className="p-4 text-xs text-muted-foreground">This request does not have a body.</p>}
        {(body.mode === 'json' || body.mode === 'text') && (
          <CodeEditor
            path={editorPath}
            language={body.mode === 'json' ? 'json' : 'plaintext'}
            value={body.raw ?? ''}
            onChange={(raw) => onChange({ ...body, raw })}
            templates
            fieldLabel="Body"
          />
        )}
        {(body.mode === 'form' || body.mode === 'urlencoded') && (
          <div className="h-full overflow-auto">
            <KeyValueEditor label="Form field" items={body.form ?? []} files={body.mode === 'form'} onChange={(form) => onChange({ ...body, form })} />
          </div>
        )}
        {body.mode === 'binary' && (
          <div className="flex max-w-2xl flex-col gap-3 p-4 text-xs">
            <div className="flex flex-col gap-1.5">
              <span className="font-medium">File</span>
              <div className="rounded-md border">
                <FilePathField borderless value={body.src ?? ''} label="Body file" onChange={(src) => onChange({ ...body, src })} />
              </div>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="font-medium">Content-Type</span>
              <input
                className="h-8 rounded-md border bg-transparent px-2.5 font-mono outline-none focus:border-ring"
                placeholder="Detected from the file extension"
                value={body.contentType ?? ''}
                onChange={(e) => onChange({ ...body, contentType: e.target.value || undefined })}
              />
            </label>
            <p className="text-muted-foreground">The file is read when the request is sent; history keeps only its name and size.</p>
          </div>
        )}
      </div>
    </div>
  );
}
