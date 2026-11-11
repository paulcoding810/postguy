import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { isTauri } from '@/lib/server';

export async function downloadJson(filename: string, data: unknown) {
  await downloadText(filename, JSON.stringify(data, null, 2), 'application/json');
}

/** Saves text via a native save dialog in Tauri, or a download link in the browser. */
export async function downloadText(filename: string, text: string, type = 'text/plain') {
  const safe = filename.replace(/[\\/:*?"<>|]/g, '_');
  if (isTauri) {
    const saved = await invoke<boolean>('save_text_file', { fileName: safe, contents: text });
    if (saved) toast.success(`Saved ${safe}`);
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = safe;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFile(accept: string): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const file = input.files?.[0];
      resolve(file ? { name: file.name, text: await file.text() } : null);
    };
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
