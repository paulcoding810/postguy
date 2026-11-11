import { buildMockApi } from './index.ts';

const port = Number(process.env.MOCK_PORT ?? 4780);
const app = buildMockApi({ logger: false });
await app.listen({ port, host: '127.0.0.1' });
console.log(`mock-api listening on http://127.0.0.1:${port}`);
