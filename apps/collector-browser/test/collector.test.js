import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCollector, isAllowedRequest } from '../src/collector.js';

function fakeBrowser(bodies, lists = {}) {
  const urls = [];
  let contextsClosed = 0;
  let browserClosed = false;
  return {
    urls,
    isConnected: () => true,
    close: async () => { browserClosed = true; },
    get closed() { return browserClosed; },
    get contextsClosed() { return contextsClosed; },
    async newContext() {
      let handler;
      const frame = {};
      return {
        async route(_pattern, callback) {
          handler = callback;
          let aborted = false;
          await handler({ request: () => ({ url: () => 'http://127.0.0.1/', method: () => 'GET', resourceType: () => 'document' }),
            abort: () => { aborted = true; }, continue: () => {} });
          assert.equal(aborted, true);
        },
        async routeWebSocket() {},
        async addInitScript() {},
        async newPage() {
          return {
            setDefaultTimeout() {},
            setDefaultNavigationTimeout() {},
            mainFrame: () => frame,
            async goto(url) {
              urls.push(url);
              const next = bodies.shift() ?? '';
              const spec = typeof next === 'string' ? { body: next } : next;
              if (spec.timeout) throw new Error('timeout');
              const response = {
                ok: () => (spec.status ?? 200) < 400,
                status: () => spec.status ?? 200,
                url: () => url,
                headers: () => spec.headers ?? {},
                body: async () => Buffer.from(spec.body || '')
              };
              let result;
              await handler({
                request: () => ({ url: () => url, method: () => 'GET', resourceType: () => 'document',
                  isNavigationRequest: () => true, frame: () => frame }),
                async fetch(options) {
                  assert.equal(options.maxRedirects, 0);
                  return response;
                },
                async fulfill(options) {
                  result = options.response || { ok: () => true, status: () => options.status,
                    url: () => url, headers: () => ({}), body: async () => Buffer.from(options.body) };
                },
                async abort() { throw new Error('aborted'); }
              });
              return result;
            },
            async waitForFunction(fn, names) {
              const original = globalThis.document;
              globalThis.document = { querySelector: (selector) => {
                const name = selector.match(/Trend list for (.+)"/)?.[1];
                return lists[name] ? { innerText: lists[name] } : null;
              } };
              try {
                if (!fn(names)) throw new Error('timeout');
              } finally {
                globalThis.document = original;
              }
            },
            async evaluate(fn, names) {
              const original = globalThis.document;
              globalThis.document = { querySelector: (selector) => {
                const name = selector.match(/Trend list for (.+)"/)?.[1];
                return lists[name] ? { innerText: lists[name] } : null;
              } };
              try { return fn(names); } finally { globalThis.document = original; }
            }
          };
        },
        async close() { contextsClosed++; }
      };
    }
  };
}

test('request filter limits documents, redirects and subresources', () => {
  const path = 'https://trends.google.com/trends/api/explore';
  assert.equal(isAllowedRequest('https://trends.google.com/trends/api/explore?x=1', 'GET', path), true);
  for (const url of ['http://trends.google.com/trends/api/explore', 'https://trends.google.com.evil.test/trends/api/explore',
    'https://localhost/trends/api/explore', 'https://trends.google.com:444/trends/api/explore',
    'https://trends.google.com/other', 'https://user@trends.google.com/trends/api/explore']) {
    assert.equal(isAllowedRequest(url, 'GET', path), false);
  }
  assert.equal(isAllowedRequest('https://trends.google.com/trends/api/explore', 'POST', path), false);
  const archive = 'https://trends.withgoogle.com/year-in-search/2023/';
  assert.equal(isAllowedRequest('https://trends.withgoogle.com/en-us/year-in-search/2023/', 'GET', archive), true);
  assert.equal(isAllowedRequest('https://trends.withgoogle.com/year-in-search/2023/us/', 'GET', archive), false);
  assert.equal(isAllowedRequest('https://trends.withgoogle.com/year-in-search/2024/', 'GET', archive), false);
  assert.equal(isAllowedRequest('https://www.gstatic.com/app.js', 'GET', archive, 'script'), true);
  assert.equal(isAllowedRequest('https://evil.test/app.js', 'GET', archive, 'script'), false);
  assert.equal(isAllowedRequest('https://www.gstatic.com/app.js', 'POST', archive, 'script'), false);
  assert.equal(isAllowedRequest('https://www.gstatic.com/app.js', 'GET', archive, 'document'), false);
});

test('follows only safe archive redirects without fetching unsafe locations', async () => {
  const fake = fakeBrowser([{ status: 302, headers: { location: '/en/year-in-search/2023/' } }, ''],
    { People: 'Alice Search it', Passings: 'Bob Search it', Athletes: 'Carol Search it' });
  const collector = createCollector({ launch: async () => fake });
  assert.deepEqual((await collector.archive({ year: 2023, geo: '' })).categories,
    [{ name: 'People', items: ['Alice'] }, { name: 'Passings', items: ['Bob'] }, { name: 'Athletes', items: ['Carol'] }]);
  assert.equal(fake.urls[1], 'https://trends.withgoogle.com/en/year-in-search/2023/');
  await collector.close();

  const unsafe = fakeBrowser([{ status: 302, headers: { location: 'http://127.0.0.1/private' } }]);
  const blocked = createCollector({ launch: async () => unsafe });
  await assert.rejects(blocked.archive({ year: 2023, geo: '' }), /unsafe redirect/);
  assert.equal(unsafe.urls.length, 1);
  await blocked.close();
});

test('handles rate limiting and navigation timeouts', async () => {
  const fake = fakeBrowser([{ status: 429, headers: { 'retry-after': '30' } }, { timeout: true }]);
  const collector = createCollector({ launch: async () => fake });
  await assert.rejects(collector.archive({ year: 2023, geo: '' }),
    (error) => error.status === 429 && error.retryAfter === '30');
  await assert.rejects(collector.archive({ year: 2023, geo: '' }), /failed or timed out/);
  assert.equal(fake.contextsClosed, 2);
  await collector.close();
});

test('builds the two fixed interest requests and parses XSSI responses', async () => {
  const fake = fakeBrowser([
    'warmup',
    `)]}',\n${JSON.stringify({ widgets: [{ id: 'TIMESERIES', token: 'abc', request: { time: '2023' } }] })}`,
    `)]}'\n${JSON.stringify({ default: { timelineData: [{ time: '123', value: [10] }] } })}`
  ]);
  const collector = createCollector({ launch: async () => fake });
  const data = await collector.interest({ keywords: ['cats'], geo: 'US', startDate: '2023-01-01', endDate: '2023-12-31' });
  assert.deepEqual(data.timelineData, [{ time: '123', value: [10] }]);
  assert.equal(fake.urls[0], 'https://trends.google.com/trends/');
  const url = new URL(fake.urls[1]);
  assert.equal(url.pathname, '/trends/api/explore');
  assert.deepEqual(JSON.parse(url.searchParams.get('req')).comparisonItem,
    [{ keyword: 'cats', geo: 'US', time: '2023-01-01 2023-12-31' }]);
  assert.equal(new URL(fake.urls[2]).pathname, '/trends/api/widgetdata/multiline');
  assert.equal(fake.contextsClosed, 1);
  await collector.close();
  assert.equal(fake.closed, true);
});

test('fails closed on bad upstream data and unsupported archive layouts', async () => {
  const fake = fakeBrowser(['warmup', 'not json', '']);
  const collector = createCollector({ launch: async () => fake });
  await assert.rejects(collector.interest({ keywords: ['a'], geo: '', startDate: '2023-01-01', endDate: '2023-12-31' }));
  await assert.rejects(collector.archive({ year: 2023, geo: '' }), /failed or timed out/);
  await assert.rejects(collector.archive({ year: 2023, geo: 'US' }), /Only the Global archive/);
  assert.equal(fake.contextsClosed, 2);
  await collector.close();
});

test('returns extracted archive categories when present', async () => {
  const fake = fakeBrowser([''], {
    People: ' Alice \nSearch it\n Bob Search it\n',
    Passings: ' Person C Search it',
    Athletes: ' Athlete D Search it'
  });
  const collector = createCollector({ launch: async () => fake });
  assert.deepEqual(await collector.archive({ year: 2023, geo: '' }),
    { year: 2023, geo: '', categories: [
      { name: 'People', items: ['Alice', 'Bob'] },
      { name: 'Passings', items: ['Person C'] },
      { name: 'Athletes', items: ['Athlete D'] }
    ] });
  assert.equal(fake.urls[0], 'https://trends.withgoogle.com/year-in-search/2023/');
  await collector.close();
});
