import { eq } from 'drizzle-orm';
import { MASK, redactJson, redactText } from '@postguy/core';
import type { ExecutionStep, FlowExecutionDetail } from '@postguy/shared';
import type { Db } from '../db/client.ts';
import { environments, flows, variables } from '../db/schema.ts';
import { getExecution } from './flows.ts';

const BODY_EXCERPT = 4000;

export interface ExecutionReport {
  format: 'postguy-execution-report';
  version: 1;
  flow: string;
  environment: string | null;
  status: FlowExecutionDetail['status'];
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  summary: { steps: number; succeeded: number; failed: number; skipped: number; assertions: { passed: number; failed: number } };
  steps: {
    name: string;
    attempt: number;
    status: ExecutionStep['status'];
    request: { method: string; url: string } | null;
    response: { status: number | null; timeMs: number; size: number; body: string | null } | null;
    schema: { ok: boolean; errors: string[] } | null;
    assertions: { ok: boolean; message: string }[];
    logs: string[];
    error: string | null;
  }[];
}

function secretValues(db: Db): string[] {
  return db
    .select({ value: variables.value })
    .from(variables)
    .where(eq(variables.isSecret, true))
    .all()
    .map((v) => v.value)
    .filter((v) => v.length >= 3);
}

function excerpt(step: ExecutionStep, secrets: string[]): string | null {
  const r = step.response;
  if (!r) return null;
  const text = r.body !== null && r.body !== undefined ? JSON.stringify(redactJson(r.body, secrets), null, 2) : redactText(r.bodyText ?? '', secrets);
  return text.length > BODY_EXCERPT ? `${text.slice(0, BODY_EXCERPT)}\n… (${text.length - BODY_EXCERPT} more characters)` : text;
}

/** A shareable summary of a run; credentials and secret values are masked. */
export function buildReport(db: Db, executionId: string): ExecutionReport {
  const exec = getExecution(db, executionId);
  const flow = db.select({ name: flows.name }).from(flows).where(eq(flows.id, exec.flowId)).get();
  const env = exec.environmentId ? db.select({ name: environments.name }).from(environments).where(eq(environments.id, exec.environmentId)).get() : undefined;
  const secrets = secretValues(db);
  const steps = exec.steps.map((s) => {
    const assertions = (s.scripts ?? []).flatMap((r) => r.assertions);
    return {
      name: s.stepName,
      attempt: s.attempt,
      status: s.status,
      request: s.request ? { method: s.request.method, url: redactText(s.request.url, secrets) } : null,
      response: s.response ? { status: s.response.status, timeMs: s.response.timeMs, size: s.response.size, body: excerpt(s, secrets) } : null,
      schema: s.validation ? { ok: s.validation.ok, errors: s.validation.errors.map((e) => `${e.path} ${e.message}`) } : null,
      assertions,
      logs: s.logs.map((l) => `${new Date(l.at).toISOString()} ${l.level.toUpperCase()} ${redactText(l.message, secrets)}`),
      error: s.error ? redactText(s.error, secrets) : null,
    };
  });
  const all = steps.flatMap((s) => s.assertions);
  return {
    format: 'postguy-execution-report',
    version: 1,
    flow: flow?.name ?? 'Flow',
    environment: env?.name ?? null,
    status: exec.status,
    error: exec.error ? redactText(exec.error, secrets) : null,
    startedAt: new Date(exec.startedAt).toISOString(),
    finishedAt: exec.finishedAt ? new Date(exec.finishedAt).toISOString() : null,
    durationMs: exec.finishedAt ? exec.finishedAt - exec.startedAt : null,
    summary: {
      steps: steps.length,
      succeeded: steps.filter((s) => s.status === 'success').length,
      failed: steps.filter((s) => s.status === 'failed').length,
      skipped: steps.filter((s) => s.status === 'skipped').length,
      assertions: { passed: all.filter((a) => a.ok).length, failed: all.filter((a) => !a.ok).length },
    },
    steps,
  };
}

const ICON = { success: '✅', failed: '❌', skipped: '⏭️', running: '⏳', pending: '•' } as const;

export function reportMarkdown(r: ExecutionReport): string {
  const lines = [
    `# ${r.flow}: ${r.status}`,
    '',
    `- Started: ${r.startedAt}${r.durationMs !== null ? ` (${r.durationMs} ms)` : ''}`,
    `- Environment: ${r.environment ?? 'none'}`,
    `- Steps: ${r.summary.succeeded} succeeded, ${r.summary.failed} failed, ${r.summary.skipped} skipped`,
    `- Assertions: ${r.summary.assertions.passed} passed, ${r.summary.assertions.failed} failed`,
    ...(r.error ? [`- Error: ${r.error}`] : []),
    '',
    '| Step | Status | Request | HTTP | Time |',
    '| --- | --- | --- | --- | --- |',
    ...r.steps.map(
      (s) =>
        `| ${s.name}${s.attempt > 1 ? ` (#${s.attempt})` : ''} | ${ICON[s.status]} ${s.status} | ${s.request ? `\`${s.request.method} ${s.request.url}\`` : ''} | ${s.response?.status ?? ''} | ${s.response ? `${Math.round(s.response.timeMs)} ms` : ''} |`,
    ),
  ];
  for (const s of r.steps) {
    lines.push('', `## ${s.name}${s.attempt > 1 ? ` (attempt ${s.attempt})` : ''}`, '');
    if (s.error) lines.push(`**Error:** ${s.error}`, '');
    if (s.schema && !s.schema.ok) lines.push('**Schema issues:**', ...s.schema.errors.map((e) => `- ${e}`), '');
    if (s.assertions.length) lines.push('**Assertions:**', ...s.assertions.map((a) => `- ${a.ok ? '✅' : '❌'} ${a.message}`), '');
    if (s.logs.length) lines.push('**Logs:**', '```', ...s.logs, '```', '');
    if (s.response?.body) lines.push('**Response:**', '```json', s.response.body, '```');
  }
  return `${lines.join('\n')}\n\n_Credentials and secret values are masked as ${MASK}._\n`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function reportHtml(r: ExecutionReport): string {
  const color = { success: '#16a34a', failed: '#dc2626', skipped: '#71717a', running: '#2563eb', pending: '#71717a', stopped: '#71717a', paused: '#d97706' } as Record<string, string>;
  const rows = r.steps
    .map(
      (s) => `<tr><td>${esc(s.name)}${s.attempt > 1 ? ` <small>#${s.attempt}</small>` : ''}</td><td style="color:${color[s.status]}">${s.status}</td><td><code>${s.request ? esc(`${s.request.method} ${s.request.url}`) : ''}</code></td><td>${s.response?.status ?? ''}</td><td>${s.response ? `${Math.round(s.response.timeMs)} ms` : ''}</td></tr>`,
    )
    .join('');
  const details = r.steps
    .map(
      (s) => `<section><h2>${esc(s.name)}${s.attempt > 1 ? ` <small>attempt ${s.attempt}</small>` : ''}</h2>
${s.error ? `<p class="err">${esc(s.error)}</p>` : ''}
${s.schema && !s.schema.ok ? `<p><b>Schema issues</b></p><ul>${s.schema.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
${s.assertions.length ? `<ul class="asserts">${s.assertions.map((a) => `<li class="${a.ok ? 'ok' : 'bad'}">${a.ok ? '✓' : '✗'} ${esc(a.message)}</li>`).join('')}</ul>` : ''}
${s.logs.length ? `<pre>${esc(s.logs.join('\n'))}</pre>` : ''}
${s.response?.body ? `<details><summary>Response body</summary><pre>${esc(s.response.body)}</pre></details>` : ''}
</section>`,
    )
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(r.flow)} report</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#18181b}h1{font-size:22px}h2{font-size:16px;margin-top:2rem}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #e4e4e7;padding:6px 8px;text-align:left;vertical-align:top}code,pre{font:12px ui-monospace,Menlo,monospace}pre{background:#f4f4f5;padding:10px;border-radius:6px;overflow:auto}.err{color:#dc2626}.asserts{list-style:none;padding:0}.ok{color:#16a34a}.bad{color:#dc2626}.meta{color:#52525b}@media(prefers-color-scheme:dark){body{background:#18181b;color:#f4f4f5}pre{background:#27272a}td,th{border-color:#3f3f46}.meta{color:#a1a1aa}}</style></head><body>
<h1>${esc(r.flow)}: <span style="color:${color[r.status]}">${r.status}</span></h1>
<p class="meta">Started ${esc(r.startedAt)}${r.durationMs !== null ? ` · ${r.durationMs} ms` : ''} · environment ${esc(r.environment ?? 'none')} · ${r.summary.succeeded} succeeded, ${r.summary.failed} failed, ${r.summary.skipped} skipped · assertions ${r.summary.assertions.passed} passed, ${r.summary.assertions.failed} failed</p>
${r.error ? `<p class="err">${esc(r.error)}</p>` : ''}
<table><thead><tr><th>Step</th><th>Status</th><th>Request</th><th>HTTP</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table>
${details}
<p class="meta">Credentials and secret values are masked as ${MASK}.</p></body></html>`;
}
