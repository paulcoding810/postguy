import { getServerInfo } from './server';

/** Reads a server-sent event stream with the server token; resolves when the stream ends. */
export async function streamEvents(path: string, onEvent: (event: string, data: unknown) => void, signal: AbortSignal): Promise<void> {
  const { baseUrl, token } = await getServerInfo();
  const res = await fetch(baseUrl + path, { headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' }, signal });
  if (!res.ok || !res.body) throw new Error(`Event stream failed: ${res.status}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (data.length) onEvent(event, JSON.parse(data.join('\n')));
    }
  }
}
