import assert from 'node:assert/strict';
import { test } from 'node:test';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { Collection, MongoClient } from 'mongodb';
import { registerHackathonRoutes } from '../domains/hackathons/routes';
import { requireGateway } from '../shared/gateway-auth';

test('durable page batches share a run timestamp and report the unique run count', async (t) => {
  for (const [key, value] of Object.entries({
    GATEWAY_INTERNAL_SECRET: 'gateway-test-secret',
    MONGODB_CONNECTION_STRING: 'mongodb://127.0.0.1:1/isolated-test',
  })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  t.mock.method(MongoClient.prototype, 'connect', async function (this: MongoClient) { return this; });
  const timestamp = '2026-11-12T12:00:00.000Z';
  let pages = 0;
  t.mock.method(https, 'request', (_target: unknown, _options: unknown, callback: (response: EventEmitter) => void) => {
    const request = new EventEmitter();
    Object.assign(request, {
      end() {
        const response = new EventEmitter();
        Object.assign(response, { statusCode: 200, setEncoding() {} });
        callback(response);
        queueMicrotask(() => {
          response.emit('data', JSON.stringify({
            hackathons: [{
              id: ++pages, title: 'Fixture Hackathon', organization_name: 'Fixture',
              thumbnail_url: '', prize_amount: '', url: 'https://example.test/event',
            }], meta: { total_count: 2, total_pages: 2, per_page: 1 },
          }));
          response.emit('end');
        });
      },
    });
    return request;
  });
  t.mock.method(Collection.prototype, 'bulkWrite', async (operations: unknown[]) => {
    const serialized = JSON.stringify(operations);
    assert.ok(serialized.includes(timestamp));
    return { acknowledged: true };
  });
  t.mock.method(Collection.prototype, 'countDocuments', async (filter: unknown) => {
    assert.deepEqual(filter, { fetchedAt: timestamp });
    return pages;
  });
  const app = express();
  app.use('/hackathons', requireGateway);
  registerHackathonRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hackathons/persist-all`;
  const headers = {
    'x-gateway-caller': 'team-2-gateway', 'x-gateway-secret': 'gateway-test-secret',
    'x-pipeline-fetched-at': timestamp,
  };
  for (const page of [1, 2]) {
    const response = await fetch(`${base}?startPage=${page}&maxPages=1`, { headers });
    const text = await response.text();
    assert.equal(response.status, 200, text);
    const result = JSON.parse(text) as { fetchedAt: string; pagesPersisted: number; runUniqueHackathonsPersisted: number };
    assert.equal(result.fetchedAt, timestamp);
    assert.equal(result.pagesPersisted, 1);
    assert.equal(result.runUniqueHackathonsPersisted, page);
  }
  assert.equal(pages, 2);
  const invalid = await fetch(base, { headers: { ...headers, 'x-pipeline-fetched-at': 'invalid' } });
  assert.equal(invalid.status, 400);
  assert.equal(pages, 2);
});
