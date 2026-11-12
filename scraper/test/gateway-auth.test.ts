import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { requireGateway } from '../shared/gateway-auth';

test('scraper operations reject direct callers and accept the main gateway', async (t) => {
  const previous = process.env.GATEWAY_INTERNAL_SECRET;
  process.env.GATEWAY_INTERNAL_SECRET = 'gateway-test-secret';
  t.after(() => {
    if (previous === undefined) delete process.env.GATEWAY_INTERNAL_SECRET;
    else process.env.GATEWAY_INTERNAL_SECRET = previous;
  });
  t.mock.method(console, 'warn', () => {});
  const app = express();
  app.use('/hackathons', requireGateway);
  app.get('/hackathons', (_request, response) => { response.json({ ok: true }); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hackathons`;
  assert.equal((await fetch(root)).status, 403);
  assert.equal((await fetch(root, {
    headers: { 'x-gateway-caller': 'team-2-gateway', 'x-gateway-secret': 'gateway-test-secret' },
  })).status, 200);
});
