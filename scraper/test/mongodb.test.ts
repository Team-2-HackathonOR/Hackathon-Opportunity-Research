import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MongoClient } from 'mongodb';
import { getHackathonsCollection } from '../mongodb';

test('a failed MongoDB connection is closed and retried instead of cached', async (t) => {
  const previous = process.env.MONGODB_CONNECTION_STRING;
  process.env.MONGODB_CONNECTION_STRING = 'mongodb://127.0.0.1:1/isolated-test';
  t.after(() => {
    if (previous === undefined) delete process.env.MONGODB_CONNECTION_STRING;
    else process.env.MONGODB_CONNECTION_STRING = previous;
  });
  let attempts = 0;
  const failure = new Error('Injected TLS connection failure');
  t.mock.method(MongoClient.prototype, 'connect', async function (this: MongoClient) {
    attempts += 1;
    if (attempts === 1) throw failure;
    return this;
  });
  const close = t.mock.method(MongoClient.prototype, 'close', async () => {});
  await assert.rejects(getHackathonsCollection(), (error) => error === failure);
  assert.equal(close.mock.callCount(), 1);
  const [first, second] = await Promise.all([getHackathonsCollection(), getHackathonsCollection()]);
  assert.equal(attempts, 2);
  assert.equal(first.collectionName, second.collectionName);
});
