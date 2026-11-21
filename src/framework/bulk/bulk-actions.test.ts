import { describe, expect, it } from 'vitest';
import { SessionSuspendedError } from 'src/session/session-events';
import type { DeleteRepositoryResult } from '../delete/delete-repository';
import {
  type BulkOutcome,
  outcomeOfDelete,
  runBulk,
  summarize,
} from './bulk-actions';

const rows = (count: number) =>
  Array.from({ length: count }, (_, n) => ({
    name: `row-${n}`,
    pulp_href: `/api/${n}/`,
  }));

// What a failed request carries: the answer of the server.
const answer = (status: number, data: unknown) => ({
  response: { status, statusText: '', data },
});

const emptyResult = (): DeleteRepositoryResult => ({
  removed: [],
  failed: [],
  pending: [],
  unknown: [],
  unlisted: [],
  unconfirmed: [],
  notSent: [],
  repositoryDeleted: false,
  repositoryError: null,
  repositoryPending: null,
  repositoryUnknown: null,
  repositoryUnconfirmed: false,
});

describe('Unit: running a bulk action', { tags: ['unit'] }, () => {
  it('has at most four jobs in flight and answers one result per row in the order of the rows', async () => {
    let inFlight = 0;
    let most = 0;

    const results = await runBulk(rows(11), async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
      return { kind: 'succeeded' } as BulkOutcome;
    });

    expect(most).toBe(4);
    expect(results.map(({ target }) => target.name)).toEqual(
      rows(11).map(({ name }) => name),
    );
  });

  it('turns a job that throws into the failure of its row and still tries the others', async () => {
    const results = await runBulk(rows(3), async ({ name }) => {
      if (name === 'row-1') {
        throw answer(400, { detail: 'No.' });
      }
      return { kind: 'succeeded' };
    });

    expect(results.map(({ outcome }) => outcome.kind)).toEqual([
      'succeeded',
      'failed',
      'succeeded',
    ]);
    expect(results[1]?.outcome).toMatchObject({
      kind: 'failed',
      reason: expect.stringContaining('No.'),
    });
  });

  it('sends nothing more once the session has ended and says which rows were not reached', async () => {
    const sent: string[] = [];

    const results = await runBulk(rows(8), async ({ name }) => {
      sent.push(name);
      if (name === 'row-1') {
        throw new SessionSuspendedError();
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { kind: 'succeeded' };
    });

    expect(sent.length).toBeLessThan(8);
    const kinds = results.map(({ outcome }) => outcome.kind);
    expect(kinds[1]).toBe('unconfirmed');
    expect(kinds.filter((kind) => kind === 'not-sent').length).toBe(
      8 - sent.length,
    );
    expect(summarize(results).stopped).toBeGreaterThan(0);
  });

  it('reports each row as it ends', async () => {
    const seen: string[] = [];

    await runBulk(
      rows(3),
      async () => ({ kind: 'succeeded' }),
      ({ target }) => {
        seen.push(target.name);
      },
    );

    expect(seen.sort()).toEqual(['row-0', 'row-1', 'row-2']);
  });
});

describe('Unit: the outcome of a repository delete', { tags: ['unit'] }, () => {
  it('is succeeded when the repository is gone, naming the distributions removed with it', () => {
    expect(
      outcomeOfDelete({
        ...emptyResult(),
        repositoryDeleted: true,
        removed: ['one', 'two'],
      }),
    ).toEqual({
      kind: 'succeeded',
      note: 'Distributions removed: one, two',
    });
  });

  it('is failed, naming the distribution that was refused and why, when the repository was kept', () => {
    const outcome = outcomeOfDelete({
      ...emptyResult(),
      removed: ['gone'],
      failed: [{ name: 'refused-one', reason: 'Not for you.' }],
    });

    expect(outcome.kind).toBe('failed');
    expect(outcome).toMatchObject({
      reason: expect.stringContaining('refused-one'),
    });
    expect(outcome).toMatchObject({
      reason: expect.stringContaining('Not for you.'),
    });
    expect(outcome).toMatchObject({
      reason: expect.stringContaining('The repository was kept.'),
    });
  });

  it('is started, with the task, while the repository is still being removed', () => {
    expect(
      outcomeOfDelete({ ...emptyResult(), repositoryPending: '/t/1/' }),
    ).toMatchObject({ kind: 'started', task: '/t/1/' });
  });

  it('is not confirmed when the session ended', () => {
    expect(outcomeOfDelete({ ...emptyResult(), notSent: ['x'] }).kind).toBe(
      'unconfirmed',
    );
  });
});
