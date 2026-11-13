import { readFileSync, statSync } from 'node:fs';
import { bodyFiles, encodeBody, fileName, type ResolvedBody } from '@postguy/core';
import { MAX_RESPONSE_BYTES } from './http.ts';

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Reads the files a body sends and encodes it. The returned body carries the bytes in `data`
 * and a summary such as `<file avatar.png, 12.3 KB>` in `content`, which history stores.
 */
export function loadBodyFiles(body: ResolvedBody): { body: ResolvedBody } | { error: { code: string; message: string } } {
  const files = bodyFiles(body);
  if (!files.length) return { body };
  const sizes = new Map<string, number>();
  let total = 0;
  for (const path of files) {
    if (!path) return { error: { code: 'FILE_NOT_FOUND', message: 'A file field has no file chosen' } };
    try {
      const st = statSync(path);
      if (!st.isFile()) return { error: { code: 'FILE_NOT_FOUND', message: `Not a file: ${path}` } };
      sizes.set(path, st.size);
      total += st.size;
    } catch {
      return { error: { code: 'FILE_NOT_FOUND', message: `File not found: ${path}` } };
    }
  }
  if (total > MAX_RESPONSE_BYTES)
    return { error: { code: 'FILE_TOO_LARGE', message: `Files total ${formatSize(total)}; the limit is ${formatSize(MAX_RESPONSE_BYTES)}` } };
  let data: Uint8Array | string | null;
  try {
    data = encodeBody(body, (path) => readFileSync(path));
  } catch (e) {
    return { error: { code: 'FILE_NOT_READABLE', message: (e as Error).message } };
  }
  const label = (path: string) => `<file ${fileName(path)}, ${formatSize(sizes.get(path) ?? 0)}>`;
  const content = body.file
    ? label(body.file)
    : (body.multipart?.parts.map((p) => `${p.name}=${'file' in p ? label(p.file) : p.value}`).join('\n') ?? body.content);
  const bytes = typeof data === 'string' || data === null ? undefined : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return { body: { ...body, content, data: bytes } };
}
