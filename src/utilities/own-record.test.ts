import { HttpResponse, delay, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from 'src/test-utils/server';
import { readOwnRecord } from './own-record';

const RECORD = '*/pulp/api/v3/users/7/';

function serveRecord(wait = 0) {
  const seen: number[] = [];
  server.use(
    http.get(RECORD, async () => {
      seen.push(seen.length + 1);
      await delay(wait);
      return HttpResponse.json({ id: 7, username: 'zoe' });
    }),
  );
  return seen;
}

describe('reading the own record', () => {
  it('sends one request for reads that overlap and gives each the answer', async () => {
    const seen = serveRecord(50);

    const [first, second] = await Promise.all([
      readOwnRecord('7', 0),
      readOwnRecord('7', 0),
    ]);

    expect(seen).toHaveLength(1);
    expect(first.data.username).toBe('zoe');
    expect(second.data.username).toBe('zoe');
  });

  it('sends a request again once the earlier read has finished', async () => {
    const seen = serveRecord();

    await readOwnRecord('7', 0);
    await readOwnRecord('7', 0);

    expect(seen).toHaveLength(2);
  });

  it('never shares a read between session epochs', async () => {
    const seen = serveRecord(50);

    await Promise.all([readOwnRecord('7', 0), readOwnRecord('7', 1)]);

    expect(seen).toHaveLength(2);
  });

  it('gives every sharer the failure and allows a new read afterwards', async () => {
    let calls = 0;
    server.use(
      http.get(RECORD, async () => {
        calls += 1;
        await delay(30);
        return HttpResponse.json({ detail: 'no' }, { status: 500 });
      }),
    );

    const results = await Promise.allSettled([
      readOwnRecord('7', 0),
      readOwnRecord('7', 0),
    ]);
    expect(results.map(({ status }) => status)).toEqual([
      'rejected',
      'rejected',
    ]);
    expect(calls).toBe(1);

    await readOwnRecord('7', 0).catch(() => undefined);
    expect(calls).toBe(2);
  });
});
