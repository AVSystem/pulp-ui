import { randomBytes } from 'node:crypto';

// Names the crawl run before any worker starts. Every screen report carries the
// name, so the teardown tells the reports of this run from files an earlier run
// left in the output directory. The workers inherit the variable.
export default function globalSetup(): void {
  process.env['PULP_UI_CRAWL_RUN'] = randomBytes(6).toString('hex');
}
