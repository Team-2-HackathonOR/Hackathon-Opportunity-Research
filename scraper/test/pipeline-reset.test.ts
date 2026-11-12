import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { Collection, MongoClient } from 'mongodb';
import { registerHackathonRoutes } from '../domains/hackathons/routes';
import { requireGateway } from '../shared/gateway-auth';

test('pipeline reset only deletes the configured scraper collection and reports failures', async (t) => {
  const previousSecret = process.env.GATEWAY_INTERNAL_SECRET;
  const previousMongo = process.env.MONGODB_CONNECTION_STRING;
  process.env.GATEWAY_INTERNAL_SECRET = 'gateway-test-secret';
  process.env.MONGODB_CONNECTION_STRING = 'mongodb://127.0.0.1:1/isolated-test';
  t.after(() => {
    if (previousSecret === undefined) delete process.env.GATEWAY_INTERNAL_SECRET;
    else process.env.GATEWAY_INTERNAL_SECRET = previousSecret;
    if (previousMongo === undefined) delete process.env.MONGODB_CONNECTION_STRING;
    else process.env.MONGODB_CONNECTION_STRING = previousMongo;
  });
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  // No network connection or real deletion is made by this test.
  t.mock.method(MongoClient.prototype, 'connect', async function (this: MongoClient) { return this; });
  let fail = false;
  const deletion = t.mock.method(Collection.prototype, 'deleteMany', async function (this: Collection, filter: unknown) {
    assert.deepEqual(filter, {});
    assert.equal(this.collectionName, process.env.MONGODB_COLLECTION_NAME?.trim() || 'hackathons');
    assert.equal(this.dbName, process.env.MONGODB_DATABASE_NAME?.trim() || 'hackathon-opportunity-research');
    if (fail) throw new Error('Injected MongoDB failure');
    return { acknowledged: true, deletedCount: 7 };
  });
  const app = express();
  app.use('/hackathons', requireGateway);
  registerHackathonRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hackathons/reset`;
  assert.equal((await fetch(url, { method: 'POST' })).status, 403);
  assert.equal(deletion.mock.callCount(), 0);
  const headers = { 'x-gateway-caller': 'team-2-gateway', 'x-gateway-secret': 'gateway-test-secret' };
  assert.equal((await fetch(url, {
    method: 'POST', headers: { ...headers, 'x-user-id': 'researcher', 'x-user-role': 'researcher' },
  })).status, 403);
  assert.equal(deletion.mock.callCount(), 0);
  const response = await fetch(url, { method: 'POST', headers });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reset: true, deletedRecords: 7 });
  fail = true;
  assert.equal((await fetch(url, { method: 'POST', headers })).status, 500);
  assert.equal(deletion.mock.callCount(), 2);
});
