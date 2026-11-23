import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { UpstreamError } from '../src/collector.js';

const token = 'a'.repeat(32);
const authorization = 'Bearer ' + token;
const calls = [];
const collector = {
  async interest(input) { calls.push(input); return { timelineData: [] }; },
  async archive(input) { calls.push(input); return { ...input, categories: [] }; }
};
const server = createServer({ token, collector });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
after(() => new Promise((resolve) => server.close(resolve)));
const base = `http://127.0.0.1:${server.address().port}`;

async function interest(body, headers = {}) {
  return fetch(`${base}/v1/trends/interest`, {
    method: 'POST', headers: { authorization, 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

const valid = { keywords: [' cats '], geo: 'US', startDate: '2023-01-01', endDate: '2023-12-31' };

test('requires authentication and a sufficiently long token', async () => {
  assert.throws(() => createServer({ token: 'short', collector }));
  assert.equal((await fetch(`${base}/v1/year-in-search?year=2023&geo=US`)).status, 401);
  assert.equal((await interest(valid, { authorization: '******' })).status, 401);
});

test('validates input and forwards normalized interest requests', async () => {
  const response = await interest(valid);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { timelineData: [] });
  assert.deepEqual(calls.at(-1), { ...valid, keywords: ['cats'] });
  for (const body of [
    { ...valid, keywords: [] },
    { ...valid, keywords: ['ok'], url: 'http://localhost' },
    { ...valid, geo: '../US' },
    { ...valid, startDate: '2023-02-29' },
    { ...valid, startDate: '2024-01-01' },
    { ...valid, keywords: Array(6).fill('a') }
  ]) assert.equal((await interest(body)).status, 400);
  assert.equal((await interest('{')).status, 400);
  assert.equal((await interest(valid, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await interest('x'.repeat(16 * 1024 + 1))).status, 413);
});

test('archive parameters are constrained and duplicates rejected', async () => {
  const response = await fetch(`${base}/v1/year-in-search?year=2023&geo=`, { headers: { authorization } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { year: 2023, geo: '', categories: [] });
  assert.equal((await fetch(`${base}/v1/year-in-search?year=2023`, { headers: { authorization } })).status, 200);
  const unsupported = await fetch(`${base}/v1/year-in-search?year=2023&geo=US`, { headers: { authorization } });
  assert.equal(unsupported.status, 422);
  assert.match((await unsupported.json()).error, /Global/);
  for (const query of ['year=2023&geo=US&url=x', 'year=2023&year=2022&geo=US',
    'year=2023&geo=..%2FUS', 'year=1999&geo=US', 'year=2023&geo=us']) {
    assert.equal((await fetch(`${base}/v1/year-in-search?${query}`, { headers: { authorization } })).status, 400);
  }
});

test('does not disclose upstream errors and rejects unknown routes', async () => {
  const failing = createServer({ token, collector: { async archive() { throw new Error('sensitive upstream details'); } } });
  await new Promise((resolve) => failing.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${failing.address().port}`;
    const response = await fetch(`${url}/v1/year-in-search?year=2023&geo=`, { headers: { authorization } });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'Upstream collection failed' });
    assert.equal((await fetch(`${url}/health`, { headers: { authorization } })).status, 404);
  } finally {
    await new Promise((resolve) => failing.close(resolve));
  }
});

test('limits concurrent upstream operations', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let started = 0;
  const limited = createServer({ token, collector: { async archive() { started++; await pending; return {}; } } });
  await new Promise((resolve) => limited.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${limited.address().port}/v1/year-in-search?year=2023&geo=`;
    const first = fetch(url, { headers: { authorization } });
    const second = fetch(url, { headers: { authorization } });
    while (started < 2) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal((await fetch(url, { headers: { authorization } })).status, 503);
    release();
    assert.equal((await first).status, 200);
    assert.equal((await second).status, 200);
  } finally {
    release();
    await new Promise((resolve) => limited.close(resolve));
  }
});

test('reports upstream rate limits without leaking details', async () => {
  const limited = createServer({ token, collector: { async archive() {
    throw new UpstreamError('private details', { status: 429, retryAfter: '30' });
  } } });
  await new Promise((resolve) => limited.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${limited.address().port}/v1/year-in-search?year=2023`;
    const response = await fetch(url, { headers: { authorization } });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '30');
    assert.deepEqual(await response.json(), { error: 'Upstream rate limited the request' });
  } finally {
    await new Promise((resolve) => limited.close(resolve));
  }
});
