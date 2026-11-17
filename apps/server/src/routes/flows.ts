import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CreateFlowInput, FlowGraphInput, UpdateFlowInput } from '@postguy/shared';
import type { Db } from '../db/client.ts';
import { parse } from '../lib/errors.ts';
import * as flows from '../services/flows.ts';
import { buildReport, reportHtml, reportMarkdown } from '../services/report.ts';

const IdParams = z.object({ id: z.string().min(1) });
const StepParams = z.object({ id: z.string().min(1), stepId: z.string().min(1) });

export function flowRoutes(app: FastifyInstance, db: Db) {
  const id = (p: unknown) => parse(IdParams, p).id;

  app.get('/flows', async () => flows.listFlows(db));
  app.post('/flows', async (req) => flows.createFlow(db, parse(CreateFlowInput, req.body)));
  app.get('/flows/:id', async (req) => flows.getFlow(db, id(req.params)));
  app.post('/flows/:id/duplicate', async (req) => flows.duplicateFlow(db, id(req.params)));
  app.patch('/flows/:id', async (req) => flows.updateFlow(db, id(req.params), parse(UpdateFlowInput, req.body)));
  app.delete('/flows/:id', async (req) => {
    flows.deleteFlow(db, id(req.params));
    return { ok: true };
  });
  app.put('/flows/:id/graph', async (req) => flows.saveGraph(db, id(req.params), parse(FlowGraphInput, req.body)));
  app.post('/flows/:id/run', async (req) => {
    const body = parse(z.object({ environmentId: z.string().nullable().optional(), debug: z.boolean().optional() }), req.body ?? {});
    return flows.runFlow(db, id(req.params), body.environmentId, body.debug);
  });
  app.get('/flows/:id/executions', async (req) => flows.listExecutions(db, id(req.params)));
  app.get('/flows/:id/sources', async (req) => flows.flowSources(db, id(req.params), parse(z.object({ stepId: z.string() }), req.query).stepId));
  app.post('/flows/:id/suggest-mappings', async (req) =>
    flows.suggestStepMappings(db, id(req.params), parse(z.object({ stepId: z.string() }), req.body).stepId),
  );

  app.get('/executions/:id', async (req) => flows.getExecution(db, id(req.params)));
  app.post('/executions/:id/continue', async (req) => {
    flows.continueExecution(id(req.params), parse(z.object({ mode: z.enum(['continue', 'step']) }), req.body).mode);
    return { ok: true };
  });
  app.get('/executions/:id/report', async (req, reply) => {
    const { format } = parse(z.object({ format: z.enum(['json', 'md', 'html']).default('md') }), req.query);
    const report = buildReport(db, id(req.params));
    if (format === 'json') return report;
    if (format === 'html') return reply.type('text/html; charset=utf-8').send(reportHtml(report));
    return reply.type('text/markdown; charset=utf-8').send(reportMarkdown(report));
  });
  app.post('/executions/:id/stop', async (req) => {
    flows.stopExecution(id(req.params));
    return { ok: true };
  });
  app.post('/executions/:id/steps/:stepId/rerun', async (req) => {
    const p = parse(StepParams, req.params);
    return flows.rerunStep(db, p.id, p.stepId);
  });

  /** Server-sent events: a full snapshot first, then each change until the run ends. */
  app.get('/executions/:id/events', (req, reply) => {
    const executionId = id(req.params);
    const detail = flows.getExecution(db, executionId);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': req.headers.origin ?? '*',
    });
    const write = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    write('snapshot', detail);
    const unsubscribe = flows.subscribe(executionId, (e) => {
      if (e.type === 'end') {
        write('end', {});
        res.end();
      } else write(e.type, e.type === 'step' ? e.step : e.execution);
    });
    if (!unsubscribe) {
      write('end', {});
      res.end();
      return;
    }
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    res.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  });
}
