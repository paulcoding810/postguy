import { invoke } from '@tauri-apps/api/core';
import { FolderOpenIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { isTauri } from '@/lib/server';
import { TemplateInput } from '@/features/template/TemplateInput';

/** Opens the native file dialog and returns the chosen path, or null when cancelled. */
export async function pickFilePath(): Promise<string | null> {
  if (!isTauri) {
    toast.message('Type or paste the full path of the file', { description: 'The browser build cannot read file paths; the desktop app has a file picker.' });
    return null;
  }
  try {
    return await invoke<string | null>('pick_file');
  } catch (e) {
    toast.error(String(e));
    return null;
  }
}

/** Opens the native folder dialog and returns the chosen path, or null when cancelled. */
export async function pickFolderPath(): Promise<string | null> {
  if (!isTauri) {
    toast.message('Type or paste the full path of the folder', { description: 'The browser build cannot read folder paths; the desktop app has a folder picker.' });
    return null;
  }
  try {
    return await invoke<string | null>('pick_folder');
  } catch (e) {
    toast.error(String(e));
    return null;
  }
}

/** A file path the server reads when the request is sent; typed, pasted or picked. */
export function FilePathField({ value, onChange, label, borderless }: { value: string; onChange: (path: string) => void; label: string; borderless?: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <TemplateInput
        className="flex-1"
        borderless={borderless}
        inputClassName="font-mono text-xs"
        value={value}
        fieldLabel={label}
        placeholder="/full/path/to/file"
        onChange={onChange}
      />
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="shrink-0"
        onClick={async () => {
          const path = await pickFilePath();
          if (path) onChange(path);
        }}
      >
        <FolderOpenIcon /> Choose…
      </Button>
    </div>
  );
}
