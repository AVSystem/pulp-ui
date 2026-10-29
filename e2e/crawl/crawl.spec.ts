import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { origin } from '../support/env';
import {
  type ConsoleError,
  type DuplicateRequest,
  type FailedRequest,
  type ScreenReport,
  type Theme,
  type Viewport,
  crawlAccount,
  screenName,
  screenPath,
  writeScreenReport,
} from './report';
import {
  type CrawlRoute,
  PLACEHOLDER,
  UNKNOWN_PATH,
  crawlRoutes,
  fillPattern,
} from './routes';

// Opens every screen of the application as the account of the run and records
// what the page did: its title, whether it crashed into the error boundary, the
// console errors, uncaught errors and failed or repeated requests it caused,
// the accessibility findings of axe, and a screenshot. The crawl only
// navigates and reads. It never clicks, types or submits anything and sends no
// request of its own besides loading the pages, so it changes nothing on the
// deployment. Findings never fail a test; only a screen that cannot be crawled
// does.

const API = '/pulp/api/';
const SETTLE_MS = 15_000;
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const account = crawlAccount();

test.describe.configure({ mode: 'parallel' });

// The path of a route relative to the UI root, with parameters filled in. The
// index is the root itself and the catch-all gets a path nothing matches.
function pathOf(route: CrawlRoute): {
  path: string;
  params: ScreenReport['params'];
} {
  if (route.pattern === '/') {
    return { path: '', params: 'none' };
  }
  if (route.pattern === '*') {
    return { path: UNKNOWN_PATH, params: 'none' };
  }
  const values = Object.fromEntries(
    route.params.map((name) => [name, PLACEHOLDER]),
  );
  return {
    path: fillPattern(route.pattern, values),
    params: route.params.length ? 'placeholder' : 'none',
  };
}

// An answer the crawl expects: the anonymous probe of the session endpoint
// says 401, and a read-only account is refused what it may not read.
function isExpected(method: string, url: URL, status: number): boolean {
  if (method === 'GET' && url.pathname.endsWith(`${API}v3/login/`)) {
    return status === 401;
  }
  return account === 'viewer' && status === 403;
}

async function uiBuild(page: Page): Promise<ScreenReport['uiBuild']> {
  const stamp = await page
    .locator('#pulp-ui-version')
    .evaluate((element) => element.innerHTML)
    .catch(() => null);
  const json = stamp?.match(/pulp-ui\s*(\{[\s\S]*\})/)?.[1];
  try {
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

for (const route of crawlRoutes()) {
  test(route.pattern, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const { theme, viewport } = testInfo.project.metadata as {
      theme: Theme;
      viewport: Viewport;
    };
    const { path, params } = pathOf(route);
    const here = origin();

    const consoleErrors: (ConsoleError & { source: string })[] = [];
    const pageErrors: string[] = [];
    const failedRequests: FailedRequest[] = [];
    const seen = new Map<string, number>();

    page.on('console', (message) => {
      if (message.type() !== 'error') {
        return;
      }
      const { url, lineNumber, columnNumber } = message.location();
      consoleErrors.push({
        text: message.text(),
        location: url ? `${url}:${lineNumber}:${columnNumber}` : '',
        source: url,
        expected: false,
      });
    });
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === here && url.pathname.includes(API)) {
        const key = `${request.method()} ${url.pathname}${url.search}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    });
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (url.origin !== here || response.status() < 400) {
        return;
      }
      const method = response.request().method();
      failedRequests.push({
        method,
        url: response.url(),
        status: response.status(),
        expected: isExpected(method, url, response.status()),
      });
    });
    page.on('requestfailed', (request) => {
      const url = new URL(request.url());
      if (url.origin !== here) {
        return;
      }
      const failure = request.failure()?.errorText ?? 'failed';
      failedRequests.push({
        method: request.method(),
        url: request.url(),
        status: 0,
        // A request the page cancels itself, for example when it navigates
        // away, is not a fault of the server.
        expected: failure === 'net::ERR_ABORTED',
        failure,
      });
    });

    const started = Date.now();
    await page.goto(path);
    let settled = true;
    await page
      .waitForLoadState('networkidle', { timeout: SETTLE_MS })
      .catch(() => (settled = false));
    await page
      .waitForFunction(
        () => !document.querySelector('.pf-v5-c-spinner'),
        null,
        {
          timeout: SETTLE_MS,
        },
      )
      .catch(() => (settled = false));
    const loadMs = Date.now() - started;

    const dark = await page.evaluate(() =>
      document.documentElement.classList.contains('pf-v5-theme-dark'),
    );
    expect(dark, `the page is in the ${theme} theme`).toBe(theme === 'dark');

    const heading = await page
      .locator('.pf-v5-c-title')
      .first()
      .textContent()
      .catch(() => null);
    const errorBoundary =
      (await page.getByText('The stack trace is:').count()) > 0 ||
      (await page.getByText('Something went horribly wrong!').count()) > 0;

    const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();

    const screenshot = screenName(route.slug, theme, viewport, 'png');
    await page.screenshot({
      path: screenPath(route.slug, theme, viewport, 'png'),
      fullPage: true,
    });

    // A console line the browser wrote for an expected answer is not an error
    // of the page.
    const expectedUrls = new Set(
      failedRequests.filter((f) => f.expected).map((f) => f.url),
    );
    const duplicateRequests: DuplicateRequest[] = [...seen]
      .filter(([, count]) => count > 1)
      .map(([key, count]) => {
        const [method = '', url = ''] = key.split(' ');
        return { method, url, count };
      });

    writeScreenReport(route.slug, {
      route: route.pattern,
      url: page.url(),
      params,
      theme,
      viewport,
      account,
      title: heading?.trim() || (await page.title()),
      errorBoundary,
      loadMs,
      settled,
      screenshot,
      consoleErrors: consoleErrors.map(({ source, ...error }) => ({
        ...error,
        expected:
          /^Failed to load resource/.test(error.text) &&
          expectedUrls.has(source),
      })),
      pageErrors,
      failedRequests,
      duplicateRequests,
      axe: {
        violations: axe.violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact ?? null,
          help: violation.help,
          nodes: violation.nodes.length,
          targets: violation.nodes
            .slice(0, 5)
            .map((node) => node.target.join(' ')),
        })),
      },
      uiBuild: await uiBuild(page),
      run: process.env['PULP_UI_CRAWL_RUN'] ?? '',
      capturedAt: new Date().toISOString(),
    });
  });
}
