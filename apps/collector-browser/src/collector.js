import { chromium } from 'playwright';

const ORIGIN = 'https://trends.google.com';
const ARCHIVE_ORIGIN = 'https://trends.withgoogle.com';
const ARCHIVE_HOSTS = new Set([
  'trends.withgoogle.com', 'www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'
]);
const ARCHIVE_CATEGORIES = ['People', 'Passings', 'Athletes'];
const MAX_BODY = 2 * 1024 * 1024;
const TIMEOUT = 15_000;

export class UpstreamError extends Error {
  constructor(message, { status = 502, retryAfter } = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function isAllowedRequest(requestUrl, method, expectedUrl, resourceType = 'document') {
  try {
    const url = new URL(requestUrl);
    const expected = new URL(expectedUrl);
    if (method !== 'GET' || url.protocol !== 'https:' || url.port ||
        url.username || url.password) return false;
    if (resourceType === 'document') {
      if (url.origin !== expected.origin) return false;
      if (url.pathname === expected.pathname) return true;
      const archive = expected.origin === ARCHIVE_ORIGIN &&
        expected.pathname.match(/^\/year-in-search\/(\d{4})\/$/);
      return !!archive && [
        `/year-in-search/${archive[1]}`,
        `/en/year-in-search/${archive[1]}/`,
        `/en-us/year-in-search/${archive[1]}/`
      ].includes(url.pathname);
    }
    if (!['script', 'stylesheet', 'font', 'image', 'xhr', 'fetch'].includes(resourceType)) return false;
    if (expected.origin === ARCHIVE_ORIGIN) return ARCHIVE_HOSTS.has(url.hostname);
    return expected.origin === ORIGIN && url.hostname === 'trends.google.com' &&
      url.pathname.startsWith('/trends/');
  } catch {
    return false;
  }
}

function apiUrl(path, params) {
  const url = new URL(path, ORIGIN);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

function parseTrendsJson(text) {
  try {
    return JSON.parse(text.replace(/^\)\]\}',?\s*/, ''));
  } catch {
    throw new UpstreamError('Invalid response from Google Trends');
  }
}

export function createCollector({ launch = () => chromium.launch({ headless: true }) } = {}) {
  let browserPromise;

  async function getBrowser() {
    if (!browserPromise) {
      browserPromise = launch().catch((error) => {
        browserPromise = undefined;
        throw error;
      });
    }
    const browser = await browserPromise;
    if (!browser.isConnected()) {
      browserPromise = undefined;
      return getBrowser();
    }
    return browser;
  }

  async function withPage(callback) {
    let context;
    try {
      const browser = await getBrowser();
      context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
      let expectedUrl;
      let redirectUrl;
      let page;
      await context.route('**/*', async (route) => {
        const request = route.request();
        const document = request.resourceType() === 'document';
        if (!isAllowedRequest(request.url(), request.method(), expectedUrl, request.resourceType()) ||
            (document && (!request.isNavigationRequest() || request.frame() !== page?.mainFrame()))) {
          return route.abort();
        }
        try {
          const response = await route.fetch({ maxRedirects: 0, timeout: TIMEOUT });
          if (response.status() >= 300 && response.status() < 400) {
            if (!document) return route.abort();
            redirectUrl = response.headers().location || '';
            return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
          }
          return route.fulfill({ response });
        } catch {
          return route.abort();
        }
      });
      await context.routeWebSocket('**/*', (socket) => socket.close());
      await context.addInitScript(() => {
        Object.defineProperty(window, 'RTCPeerConnection', { value: undefined, configurable: false });
        Object.defineProperty(window, 'webkitRTCPeerConnection', { value: undefined, configurable: false });
      });
      page = await context.newPage();
      page.setDefaultTimeout(TIMEOUT);
      page.setDefaultNavigationTimeout(TIMEOUT);
      return await callback(page, {
        expect(url) { expectedUrl = url; redirectUrl = undefined; },
        redirect() { return redirectUrl; }
      });
    } catch (error) {
      if (error instanceof UpstreamError) throw error;
      throw new UpstreamError('Google Trends request failed or timed out');
    } finally {
      if (context) await context.close().catch(() => {});
    }
  }

  async function navigate(page, routing, url) {
    let response;
    let nextUrl = url;
    for (let redirects = 0; redirects <= 3; redirects++) {
      routing.expect(url);
      response = await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      const location = routing.redirect();
      if (location === undefined) break;
      if (!location || redirects === 3) throw new UpstreamError('Google Trends returned an unsafe redirect');
      try {
        nextUrl = new URL(location, nextUrl).toString();
      } catch {
        throw new UpstreamError('Google Trends returned an unsafe redirect');
      }
      if (!isAllowedRequest(nextUrl, 'GET', url)) throw new UpstreamError('Google Trends returned an unsafe redirect');
    }
    if (response?.status() === 429) {
      const retryAfter = response.headers()['retry-after'];
      throw new UpstreamError('Google Trends rate limited the request', {
        status: 429,
        retryAfter: /^\d{1,4}$/.test(retryAfter || '') && Number(retryAfter) <= 3600 ? retryAfter : undefined
      });
    }
    if (!response || !response.ok() || !isAllowedRequest(response.url(), 'GET', url)) {
      throw new UpstreamError('Google Trends returned an error or unsafe redirect');
    }
    const contentLength = Number(response.headers()['content-length']);
    if (contentLength > MAX_BODY) throw new UpstreamError('Google Trends response too large');
    return response;
  }

  async function getJson(page, routing, path, params) {
    const response = await navigate(page, routing, apiUrl(path, params));
    const body = await response.body();
    if (body.length > MAX_BODY) throw new UpstreamError('Google Trends response too large');
    return parseTrendsJson(body.toString('utf8'));
  }

  return {
    async interest({ keywords, geo, startDate, endDate }) {
      const time = `${startDate} ${endDate}`;
      const request = {
        comparisonItem: keywords.map((keyword) => ({ keyword, geo, time })),
        category: 0,
        property: ''
      };
      return withPage(async (page, routing) => {
        await navigate(page, routing, `${ORIGIN}/trends/`);
        const explore = await getJson(page, routing, '/trends/api/explore', {
          hl: 'en-US', tz: '0', req: JSON.stringify(request)
        });
        const widget = Array.isArray(explore?.widgets)
          ? explore.widgets.find((item) => item?.id === 'TIMESERIES')
          : undefined;
        if (!widget || typeof widget.token !== 'string' || !widget.request ||
            typeof widget.request !== 'object') {
          throw new UpstreamError('Google Trends did not provide a time series');
        }
        const result = await getJson(page, routing, '/trends/api/widgetdata/multiline', {
          hl: 'en-US', tz: '0', req: JSON.stringify(widget.request), token: widget.token
        });
        const timelineData = result?.default?.timelineData;
        if (!Array.isArray(timelineData)) throw new UpstreamError('Google Trends did not provide timeline data');
        return { timelineData };
      });
    },

    async archive({ year, geo }) {
      if (geo !== '') throw new UpstreamError('Only the Global archive is supported', { status: 422 });
      if (!Number.isInteger(year) || year < 2001 || year > new Date().getUTCFullYear()) {
        throw new UpstreamError('Invalid archive year', { status: 400 });
      }
      const url = `${ARCHIVE_ORIGIN}/year-in-search/${year}/`;
      return withPage(async (page, routing) => {
        const response = await navigate(page, routing, url);
        if ((await response.body()).length > MAX_BODY) throw new UpstreamError('Google Trends response too large');
        await page.waitForFunction((names) => names.every((name) =>
          document.querySelector(`[aria-label="Trend list for ${name}"]`)?.innerText.includes('Search it')),
        ARCHIVE_CATEGORIES, { timeout: TIMEOUT });
        const categories = await page.evaluate((names) => names.flatMap((name) => {
          const text = document.querySelector(`[aria-label="Trend list for ${name}"]`)?.innerText || '';
          const items = text.split('Search it').map((item) => item.trim().slice(0, 500))
            .filter(Boolean).slice(0, 100);
          return items.length ? [{ name, items }] : [];
        }), ARCHIVE_CATEGORIES);
        if (!categories.length) throw new UpstreamError('Year in Search archive is unavailable or has an unsupported layout');
        return { year, geo, categories };
      });
    },

    async close() {
      if (browserPromise) {
        const browser = await browserPromise.catch(() => undefined);
        browserPromise = undefined;
        if (browser) await browser.close();
      }
    }
  };
}
