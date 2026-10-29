import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  SCREEN_FILE,
  type ScreenReport,
  THEMES,
  VIEWPORTS,
  outDir,
  screenName,
} from './report';
import { type CrawlRoute, crawlRoutes } from './routes';

// Turns the per-screen reports of a crawl into index.json (what was crawled and
// the totals) and summary.md (one row per screen, worst first, followed by the
// findings grouped across screens), for a person or an agent to act on without
// opening every report. Both are written by the global teardown, after every
// project has finished. index.json is written only when every screen of every
// route was captured, so a crawl that was interrupted, or that crashed on one
// screen, leaves none and the completeness check refuses the output.
//
// The summary and the index name no host and carry no session data: request
// addresses are reduced to their path.

const IMPACT_WEIGHT: Record<string, number> = {
  critical: 10,
  serious: 5,
  moderate: 2,
  minor: 1,
};

const unexpected = <T extends { expected: boolean }>(items: T[]): T[] =>
  items.filter((item) => !item.expected);

// How badly a screen is broken, as one number: a crash outweighs an uncaught
// error, which outweighs a failed request, a console error, an accessibility
// finding and a repeated request, in that order.
export function scoreOf(report: ScreenReport): number {
  return (
    (report.errorBoundary ? 1000 : 0) +
    report.pageErrors.length * 100 +
    unexpected(report.failedRequests).length * 50 +
    unexpected(report.consoleErrors).length * 20 +
    (report.settled === false ? 30 : 0) +
    report.axe.violations.reduce(
      (sum, violation) => sum + (IMPACT_WEIGHT[violation.impact ?? ''] ?? 1),
      0,
    ) +
    report.duplicateRequests.length
  );
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// Worst first; screens with the same score are ordered by route pattern, then
// theme, then width, so two crawls of the same data give the same summary.
export function orderScreens(reports: ScreenReport[]): ScreenReport[] {
  return [...reports].sort(
    (a, b) =>
      scoreOf(b) - scoreOf(a) ||
      compare(a.route, b.route) ||
      compare(a.theme, b.theme) ||
      compare(a.viewport, b.viewport),
  );
}

// Printable ASCII only, so the files read the same everywhere.
function ascii(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, '?');
}

function asciiJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(
    /[^\x20-\x7e\n]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

function cell(value: string, limit = 140): string {
  const flat = ascii(value.replace(/\s+/g, ' ')).replace(/\|/g, '/').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 3)}...` : flat;
}

// The path of an address, with ids that differ between objects folded together.
function pathOf(address: string): string {
  try {
    const { pathname } = new URL(address);
    return pathname.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{23}/g, '<id>');
  } catch {
    return cell(address);
  }
}

function tally<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  }
  return counts;
}

function byCount(counts: Map<string, number>): [string, number][] {
  return [...counts].sort((a, b) => b[1] - a[1] || compare(a[0], b[0]));
}

export interface Totals {
  screens: number;
  errorBoundary: number;
  pageErrors: number;
  failedRequests: number;
  expectedFailedRequests: number;
  consoleErrors: number;
  expectedConsoleErrors: number;
  duplicateRequests: number;
  axeViolations: number;
  unsettled: number;
  placeholderParams: number;
}

export function totalsOf(reports: ScreenReport[]): Totals {
  const sum = (pick: (report: ScreenReport) => number) =>
    reports.reduce((total, report) => total + pick(report), 0);
  return {
    screens: reports.length,
    errorBoundary: sum((r) => (r.errorBoundary ? 1 : 0)),
    pageErrors: sum((r) => r.pageErrors.length),
    failedRequests: sum((r) => unexpected(r.failedRequests).length),
    expectedFailedRequests: sum(
      (r) => r.failedRequests.filter((f) => f.expected).length,
    ),
    consoleErrors: sum((r) => unexpected(r.consoleErrors).length),
    expectedConsoleErrors: sum(
      (r) => r.consoleErrors.filter((c) => c.expected).length,
    ),
    duplicateRequests: sum((r) => r.duplicateRequests.length),
    axeViolations: sum((r) => r.axe.violations.length),
    unsettled: sum((r) => (r.settled === false ? 1 : 0)),
    placeholderParams: sum((r) => (r.params === 'placeholder' ? 1 : 0)),
  };
}

function hostOf(reports: ScreenReport[]): string {
  try {
    return new URL(reports[0]?.url ?? '').host;
  } catch {
    return '';
  }
}

export interface Index {
  run: string;
  complete: boolean;
  account: string;
  baseUrlHost: string;
  uiBuild: ScreenReport['uiBuild'];
  firstCapture: string;
  lastCapture: string;
  routes: { pattern: string; slug: string; params: string[] }[];
  totals: Totals;
  screens: {
    route: string;
    theme: string;
    viewport: string;
    file: string;
    screenshot: string;
    score: number;
  }[];
}

export function buildIndex(
  reports: ScreenReport[],
  routes: CrawlRoute[],
  run: string,
  complete: boolean,
): Index {
  const slugs = new Map(routes.map((route) => [route.pattern, route.slug]));
  const captured = reports.map((report) => report.capturedAt).sort();
  return {
    run,
    complete,
    account: reports[0]?.account ?? '',
    baseUrlHost: hostOf(reports),
    uiBuild: reports.find((report) => report.uiBuild)?.uiBuild ?? null,
    firstCapture: captured[0] ?? '',
    lastCapture: captured[captured.length - 1] ?? '',
    routes: routes.map(({ pattern, slug, params }) => ({
      pattern,
      slug,
      params,
    })),
    totals: totalsOf(reports),
    screens: orderScreens(reports).map((report) => ({
      route: report.route,
      theme: report.theme,
      viewport: report.viewport,
      file: screenName(
        slugs.get(report.route) ?? '',
        report.theme,
        report.viewport,
        'json',
      ),
      screenshot: report.screenshot,
      score: scoreOf(report),
    })),
  };
}

export function renderSummary(
  reports: ScreenReport[],
  routes: CrawlRoute[],
  complete: boolean,
): string {
  const ordered = orderScreens(reports);
  const totals = totalsOf(reports);
  const host = hostOf(reports);
  const hide = (text: string) =>
    host ? text.split(host).join('<host>') : text;
  const slugs = new Map(routes.map((route) => [route.pattern, route.slug]));
  const build = reports.find((report) => report.uiBuild)?.uiBuild;
  const captured = reports.map((report) => report.capturedAt).sort();

  const lines: string[] = [
    '# Screen crawl',
    '',
    `- Account: ${reports[0]?.account ?? 'none'}`,
    `- UI build: ${build?.hash ?? 'unknown'} (version ${build?.version ?? 'unknown'})`,
    `- Captured: ${captured[0] ?? ''} to ${captured[captured.length - 1] ?? ''}`,
    `- Screens: ${totals.screens} of ${routes.length * THEMES.length * VIEWPORTS.length} (${routes.length} routes, ${THEMES.length} themes, ${VIEWPORTS.length} widths)`,
    `- Complete: ${complete ? 'yes' : 'no'}`,
    `- Screens are ordered worst first; equal scores by route, theme, width. The score weighs an error page 1000, an uncaught error 100, a failed request 50, a console error 20, a screen that never settled 30, an accessibility rule by impact (critical 10, serious 5, moderate 2, minor 1) and a repeated request 1.`,
    '',
    '## Totals',
    '',
    '| Finding | Count |',
    '|---|---|',
    `| Screens that crashed into the error page | ${totals.errorBoundary} |`,
    `| Uncaught errors | ${totals.pageErrors} |`,
    `| Failed requests | ${totals.failedRequests} |`,
    `| Console errors | ${totals.consoleErrors} |`,
    `| Accessibility rule violations | ${totals.axeViolations} |`,
    `| Repeated requests | ${totals.duplicateRequests} |`,
    `| Screens that did not settle | ${totals.unsettled} |`,
    `| Screens visited with a placeholder parameter | ${totals.placeholderParams} |`,
    `| Expected failed requests (not counted above) | ${totals.expectedFailedRequests} |`,
    `| Console lines of expected failed requests (not counted above) | ${totals.expectedConsoleErrors} |`,
    '',
    '## Screens',
    '',
    '| # | Route | Theme | Width | Params | Score | Error page | Uncaught | Failed | Console | Axe | Repeated | Settled | Load ms | Report |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];

  ordered.forEach((report, position) => {
    lines.push(
      [
        position + 1,
        cell(report.route),
        report.theme,
        report.viewport,
        report.params,
        scoreOf(report),
        report.errorBoundary ? 'yes' : 'no',
        report.pageErrors.length,
        unexpected(report.failedRequests).length,
        unexpected(report.consoleErrors).length,
        report.axe.violations.length,
        report.duplicateRequests.length,
        report.settled === false ? 'no' : 'yes',
        report.loadMs,
        screenName(
          slugs.get(report.route) ?? '',
          report.theme,
          report.viewport,
          'json',
        ),
      ]
        .join(' | ')
        .replace(/^/, '| ')
        .replace(/$/, ' |'),
    );
  });

  const rules = new Map<
    string,
    { impact: string; help: string; screens: number; nodes: number }
  >();
  for (const report of reports) {
    for (const violation of report.axe.violations) {
      const rule = rules.get(violation.id) ?? {
        impact: violation.impact ?? 'unknown',
        help: violation.help,
        screens: 0,
        nodes: 0,
      };
      rule.screens += 1;
      rule.nodes += violation.nodes;
      rules.set(violation.id, rule);
    }
  }
  lines.push('', '## Accessibility rules', '');
  if (rules.size === 0) {
    lines.push('None.');
  } else {
    lines.push(
      '| Rule | Impact | Screens | Nodes | What it says |',
      '|---|---|---|---|---|',
    );
    for (const [id, rule] of [...rules].sort(
      (a, b) =>
        (IMPACT_WEIGHT[b[1].impact] ?? 0) - (IMPACT_WEIGHT[a[1].impact] ?? 0) ||
        b[1].screens - a[1].screens ||
        compare(a[0], b[0]),
    )) {
      lines.push(
        `| ${id} | ${rule.impact} | ${rule.screens} | ${rule.nodes} | ${cell(rule.help)} |`,
      );
    }
  }

  const failed = tally(
    reports.flatMap((report) =>
      unexpected(report.failedRequests).map((request) =>
        [
          request.method,
          String(request.status || request.failure),
          pathOf(request.url),
        ].join('\t'),
      ),
    ),
    (key) => key,
  );
  lines.push('', '## Failed requests', '');
  if (failed.size === 0) {
    lines.push('None.');
  } else {
    lines.push('| Method | Answer | Path | Times |', '|---|---|---|---|');
    for (const [key, count] of byCount(failed)) {
      const [method = '', answer = '', path = ''] = key.split('\t');
      lines.push(`| ${method} | ${answer} | ${cell(path, 200)} | ${count} |`);
    }
  }

  const consoleLines = tally(
    reports.flatMap((report) =>
      unexpected(report.consoleErrors).map((entry) => hide(entry.text)),
    ),
    (text) => text,
  );
  lines.push('', '## Console errors', '');
  if (consoleLines.size === 0) {
    lines.push('None.');
  } else {
    lines.push('| Text | Times |', '|---|---|');
    for (const [text, count] of byCount(consoleLines)) {
      lines.push(`| ${cell(hide(text), 200)} | ${count} |`);
    }
  }

  const uncaught = tally(
    reports.flatMap((report) => report.pageErrors.map(hide)),
    (text) => text,
  );
  lines.push('', '## Uncaught errors', '');
  if (uncaught.size === 0) {
    lines.push('None.');
  } else {
    lines.push('| Text | Times |', '|---|---|');
    for (const [text, count] of byCount(uncaught)) {
      lines.push(`| ${cell(text, 200)} | ${count} |`);
    }
  }

  const repeated = tally(
    reports.flatMap((report) =>
      report.duplicateRequests.map(
        (request) => `${request.method} ${pathOf(request.url)}`,
      ),
    ),
    (key) => key,
  );
  lines.push('', '## Repeated requests', '');
  if (repeated.size === 0) {
    lines.push('None.');
  } else {
    lines.push('| Request | Screens |', '|---|---|');
    for (const [key, count] of byCount(repeated).slice(0, 40)) {
      lines.push(`| ${cell(key, 200)} | ${count} |`);
    }
  }

  return `${lines.join('\n')}\n`;
}

// What was left in a directory by crawls: the reports it holds, by file name.
function readReports(dir: string): Map<string, ScreenReport> {
  const found = new Map<string, ScreenReport>();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json') || !SCREEN_FILE.test(file)) {
      continue;
    }
    try {
      found.set(file, JSON.parse(readFileSync(join(dir, file), 'utf8')));
    } catch {
      // A half-written file belongs to a run that did not finish.
    }
  }
  return found;
}

// Writes the summary of the run named `run` into dir, and its index when the
// run is complete. Reports and screenshots of other runs, and the index and
// summary of an earlier run, are removed first, so the directory always shows
// one run. Returns false when the run left no report (a run without crawl
// tests), in which case nothing is touched.
export function summarizeRun(
  dir: string,
  routes: CrawlRoute[],
  run: string,
): boolean {
  if (!run || !existsSync(dir)) {
    return false;
  }
  const all = readReports(dir);
  const mine = [...all].filter(([, report]) => report.run === run);
  if (mine.length === 0) {
    return false;
  }

  for (const file of readdirSync(dir)) {
    if (!SCREEN_FILE.test(file)) {
      continue;
    }
    const report = all.get(file.replace(/\.png$/, '.json'));
    if (report?.run !== run) {
      rmSync(join(dir, file), { force: true });
    }
  }
  rmSync(join(dir, 'index.json'), { force: true });
  rmSync(join(dir, 'summary.md'), { force: true });

  const reports = mine.map(([, report]) => report);
  const slugs = new Set(routes.map((route) => route.slug));
  const present = new Set(
    reports.map(
      (report) => `${report.route}|${report.theme}|${report.viewport}`,
    ),
  );
  const complete =
    routes.every((route) =>
      THEMES.every((theme) =>
        VIEWPORTS.every((viewport) =>
          present.has(`${route.pattern}|${theme}|${viewport}`),
        ),
      ),
    ) && slugs.size === routes.length;

  writeFileSync(
    join(dir, 'summary.md'),
    renderSummary(reports, routes, complete),
  );
  if (complete) {
    writeFileSync(
      join(dir, 'index.json'),
      `${asciiJson(buildIndex(reports, routes, run, true))}\n`,
    );
  } else {
    console.log(
      `crawl incomplete: ${present.size} of ${routes.length * THEMES.length * VIEWPORTS.length} screens captured, no index.json written`,
    );
  }
  return true;
}

export default function globalTeardown(): void {
  const run = process.env['PULP_UI_CRAWL_RUN'] ?? '';
  const dir = outDir();
  // Without reports of this run (smoke or remote runs) nothing is read from
  // the source tree and nothing is written.
  if (
    !run ||
    !existsSync(dir) ||
    !readdirSync(dir).some((f) => SCREEN_FILE.test(f))
  ) {
    return;
  }
  summarizeRun(dir, crawlRoutes(), run);
}
