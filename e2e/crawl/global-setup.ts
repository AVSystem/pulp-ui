import { randomBytes } from 'node:crypto';
import { runId } from '../support/api';

// Names the runs before any worker starts. The crawl name goes on every screen
// report, so the teardown tells the reports of this run from files an earlier
// run left in the output directory. The run id prefixes every object the remote
// tests write, so one id for all workers (and for a worker that is restarted
// after a crash) means a later clean-up looks for the same prefix. The workers
// inherit both variables.
export default function globalSetup(): void {
  process.env['PULP_UI_CRAWL_RUN'] = randomBytes(6).toString('hex');
  runId();
}
