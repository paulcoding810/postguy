// Loaded before the app as its own module, so it still runs when the app fails to load.
// Shows startup errors instead of an empty window.
const shown = new Set<string>();

function show(message: string, detail = '') {
  if (document.getElementById('root')?.childElementCount) return;
  const key = message + detail;
  if (shown.has(key)) return;
  shown.add(key);
  let box = document.getElementById('pg-boot-error');
  if (!box) {
    box = document.createElement('div');
    box.id = 'pg-boot-error';
    box.style.cssText =
      'position:fixed;inset:0;overflow:auto;padding:32px;font:13px ui-monospace,Menlo,monospace;background:#18181b;color:#f4f4f5;z-index:99999;white-space:pre-wrap';
    box.textContent = 'Postguy could not start.\n\n';
    document.body.appendChild(box);
  }
  box.textContent += `${message}\n${detail}\n\n`;
}

window.addEventListener(
  'error',
  (e) => {
    const target = e.target as HTMLElement | null;
    if (target && target !== (window as unknown as HTMLElement) && 'src' in target) show(`Failed to load ${(target as HTMLScriptElement).src}`);
    else show(e.message || String(e.error), e.error?.stack ?? `${e.filename}:${e.lineno}:${e.colno}`);
  },
  true,
);
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason as Error | undefined;
  show(`Unhandled rejection: ${r?.message ?? String(r)}`, r?.stack ?? '');
});
setTimeout(() => {
  if (!document.getElementById('root')?.childElementCount) show('The interface did not render within 10 seconds.', 'Open the developer tools (right-click → Inspect in development builds) for details.');
}, 10_000);
