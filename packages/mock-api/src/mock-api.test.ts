import { describe, expect, it } from 'vitest';
import { buildMockApi } from './index.ts';

describe('mock api', () => {
  it('logs in and fetches profile, orders and order details with a fresh token', async () => {
    const app = buildMockApi();
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { username: 'john', password: 'secret' } });
    expect(login.statusCode).toBe(200);
    const { access_token, user } = login.json().data;
    const auth = { authorization: `Bearer ${access_token}` };

    const profile = await app.inject({ url: `/users/${user.id}`, headers: auth });
    expect(profile.json().data).toMatchObject({ id: 1001, email: 'john@example.com' });

    const list = await app.inject({ url: `/users/${user.id}/orders`, headers: auth });
    expect(list.json().meta.total).toBe(2);

    const order = await app.inject({ url: `/orders/${list.json().data[0].id}`, headers: auth });
    expect(order.json().data.payment.type).toBe('card');

    expect((await app.inject({ url: '/users/1001' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/users/1002', headers: auth })).statusCode).toBe(403);
  });

  it('rejects bad credentials', async () => {
    const res = await buildMockApi().inject({ method: 'POST', url: '/auth/login', payload: { username: 'john', password: 'x' } });
    expect(res.statusCode).toBe(401);
  });
});
