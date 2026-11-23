import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { UpstreamError } from './collector.js';

const MAX_REQUEST = 16 * 1024;
const MAX_CONCURRENT = 2;

class ClientError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function validateInterest(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object' ||
      Object.keys(value).some((key) => !['keywords', 'geo', 'startDate', 'endDate'].includes(key)) ||
      !Array.isArray(value.keywords) || value.keywords.length < 1 || value.keywords.length > 5 ||
      value.keywords.some((item) => typeof item !== 'string' || !item.trim() || item.length > 100) ||
      typeof value.geo !== 'string' || !/^(?:[A-Z]{2})?$/.test(value.geo) ||
      !validDate(value.startDate) || !validDate(value.endDate) || value.startDate > value.endDate) {
    throw new ClientError(400, 'Invalid interest request');
  }
  return { ...value, keywords: value.keywords.map((item) => item.trim()) };
}

function validateArchive(url) {
  if ([...url.searchParams.keys()].some((key) => !['year', 'geo'].includes(key)) ||
      url.searchParams.getAll('year').length !== 1 || url.searchParams.getAll('geo').length > 1) {
    throw new ClientError(400, 'Invalid archive request');
  }
  const year = url.searchParams.get('year');
  const geo = url.searchParams.get('geo') ?? '';
  if (!/^\d{4}$/.test(year) || Number(year) < 2001 ||
      Number(year) > new Date().getUTCFullYear() || !/^(?:[A-Z]{2})?$/.test(geo)) {
    throw new ClientError(400, 'Invalid archive request');
  }
  if (geo) throw new ClientError(422, 'Only the Global archive is supported');
  return { year: Number(year), geo };
}

async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
    throw new ClientError(415, 'Content-Type must be application/json');
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_REQUEST) {
        tooLarge = true;
        reject(new ClientError(413, 'Request body too large'));
      } else {
        chunks.push(chunk);
      }
    });
    request.on('end', () => {
      if (tooLarge) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new ClientError(400, 'Invalid JSON'));
      }
    });
    request.on('aborted', () => reject(new ClientError(400, 'Request aborted')));
    request.on('error', () => reject(new ClientError(400, 'Request failed')));
  });
}

function send(response, status, data, headers = {}) {
  if (response.destroyed) return;
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  response.end(JSON.stringify(data));
}

export function createServer({ token, collector }) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 512 || /[\r\n]/.test(token)) {
    throw new Error('COLLECTOR_TOKEN must be between 32 and 512 characters');
  }
  const expected = createHash('sha256').update('Bearer ').update(token).digest();
  let active = 0;
  const server = http.createServer(async (request, response) => {
    const auth = request.headers.authorization || '';
    const actual = createHash('sha256').update(auth).digest();
    if (!timingSafeEqual(expected, actual)) return send(response, 401, { error: 'Unauthorized' });

    let acquired = false;
    try {
      const url = new URL(request.url, 'http://localhost');
      let action;
      let input;
      if (request.method === 'POST' && url.pathname === '/v1/trends/interest' && !url.search) {
        action = 'interest';
        input = validateInterest(await readJson(request));
      } else if (request.method === 'GET' && url.pathname === '/v1/year-in-search') {
        action = 'archive';
        input = validateArchive(url);
      } else {
        throw new ClientError(404, 'Not found');
      }
      if (active >= MAX_CONCURRENT) throw new ClientError(503, 'Collector is busy');
      active++;
      acquired = true;
      const result = await collector[action](input);
      send(response, 200, result);
    } catch (error) {
      if (error instanceof ClientError) send(response, error.status, { error: error.message });
      else if (error instanceof UpstreamError && error.status === 429) {
        send(response, 429, { error: 'Upstream rate limited the request' },
          error.retryAfter ? { 'retry-after': error.retryAfter } : {});
      }
      else send(response, 502, { error: 'Upstream collection failed' });
    } finally {
      if (acquired) active--;
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  return server;
}
