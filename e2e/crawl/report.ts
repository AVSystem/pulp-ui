import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type Role } from '../support/accounts';

// The record the crawler keeps of every screen it visits, and where it is
// written. One screen is one route pattern in one theme at one width; its
// report is <slug>.<theme>.<viewport>.json next to <slug>.<theme>.<viewport>.png.
// The reports show the deployment's data and URLs: the output directory is
// ignored by git and is never uploaded anywhere.

export type Theme = 'light' | 'dark';
export type Viewport = 'desktop' | 'phone';

export const THEMES: Theme[] = ['light', 'dark'];
export const VIEWPORTS: Viewport[] = ['desktop', 'phone'];

export const SCREEN_SIZES: Record<Viewport, { width: number; height: number }> =
  {
    desktop: { width: 1440, height: 900 },
    phone: { width: 390, height: 844 },
  };

export interface ConsoleError {
  text: string;
  location: string;
  // The browser logs every failed request as a console error; the line that
  // belongs to an answer the crawl expects is marked and not counted.
  expected: boolean;
}

export interface FailedRequest {
  method: string;
  url: string;
  // 0 when the request never got an answer.
  status: number;
  expected: boolean;
  failure?: string;
}

export interface DuplicateRequest {
  method: string;
  url: string;
  count: number;
}

export interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: number;
  targets: string[];
}

export interface ScreenReport {
  route: string;
  url: string;
  params: 'resolved' | 'placeholder' | 'none';
  theme: Theme;
  viewport: Viewport;
  account: Role;
  title: string;
  errorBoundary: boolean;
  loadMs: number;
  // False when the page still showed a spinner or kept the network busy at
  // the end of the wait.
  settled: boolean;
  screenshot: string;
  consoleErrors: ConsoleError[];
  pageErrors: string[];
  failedRequests: FailedRequest[];
  duplicateRequests: DuplicateRequest[];
  axe: { violations: AxeViolation[] };
  // The build stamp the application carries, null when the page has none.
  uiBuild: { hash?: string; date?: string | null; version?: string } | null;
  // Identifies the crawl run that wrote the file, so a report left by an
  // earlier run is never mistaken for part of this one.
  run: string;
  capturedAt: string;
}

export function crawlAccount(): Role {
  const value = process.env['PULP_UI_CRAWL_ACCOUNT'] ?? 'admin';
  if (value !== 'admin' && value !== 'viewer') {
    throw new Error(
      `PULP_UI_CRAWL_ACCOUNT must be "admin" or "viewer", got "${value}"`,
    );
  }
  return value;
}

// PULP_UI_CRAWL_OUT, relative to the directory the run starts in.
export function outDir(): string {
  return resolve(process.env['PULP_UI_CRAWL_OUT'] || 'crawl-report');
}

export function screenName(
  slug: string,
  theme: Theme,
  viewport: Viewport,
  extension: 'json' | 'png',
): string {
  return `${slug}.${theme}.${viewport}.${extension}`;
}

// Matches the files a crawl writes and nothing else that may share the directory.
export const SCREEN_FILE = /\.(light|dark)\.(desktop|phone)\.(json|png)$/;

export function screenPath(
  slug: string,
  theme: Theme,
  viewport: Viewport,
  extension: 'json' | 'png',
): string {
  return join(outDir(), screenName(slug, theme, viewport, extension));
}

export function writeScreenReport(slug: string, report: ScreenReport): void {
  mkdirSync(outDir(), { recursive: true });
  writeFileSync(
    screenPath(slug, report.theme, report.viewport, 'json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}
