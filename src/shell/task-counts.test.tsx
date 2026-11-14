import { act, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { Link } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PulpMenu } from 'src/menu';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { COUNT_REFRESH_MS } from './task-counts';

const TASKS = '*/pulp/api/v3/tasks/';

function signIn() {
  server.use(
    http.get('*/pulp/api/v3/login/', () =>
      HttpResponse.json({
        username: 'zoe',
        pulp_href: '/pulp/api/v3/users/1/',
      }),
    ),
  );
}

interface ICounts {
  running?: number | 'fail' | 'forbidden';
  failed?: number | 'fail' | 'forbidden';
}

// Answers the two count requests and records the query of each.
function answerCounts(counts: ICounts) {
  const queries: URLSearchParams[] = [];
  server.use(
    http.get(TASKS, ({ request }) => {
      const query = new URL(request.url).searchParams;
      queries.push(new URLSearchParams(query));
      const wanted = counts[query.get('state') as 'running' | 'failed'] ?? 0;
      if (wanted === 'fail') {
        return HttpResponse.json({ detail: 'boom' }, { status: 500 });
      }
      if (wanted === 'forbidden') {
        return HttpResponse.json({ detail: 'no' }, { status: 403 });
      }
      return HttpResponse.json({
        count: wanted,
        next: null,
        previous: null,
        results: [],
      });
    }),
  );
  return queries;
}

const tasksLink = () => screen.getByRole('link', { name: /^Tasks/ });
const pill = (kind: 'running' | 'failed') =>
  tasksLink().querySelector(`.pulp-count--${kind}`);

async function renderMenu(route = '/repositories/file/repository/') {
  signIn();
  const view = renderWithProviders(
    <>
      <Link to='/tasks'>go to tasks</Link>
      <Link to='/status'>go to status</Link>
      <PulpMenu />
    </>,
    { route },
  );
  await screen.findByRole('link', { name: /^Tasks/ });
  return view;
}

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
}

describe('task count pills', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2030-05-01T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('shows the running and the failed count, running first', async () => {
    answerCounts({ running: 3, failed: 2 });

    await renderMenu();

    await waitFor(() => expect(pill('running')).toHaveTextContent('3'));
    expect(pill('failed')).toHaveTextContent('2');
    const pills = tasksLink().querySelectorAll('.pulp-count');
    expect(pills[0]).toBe(pill('running'));
    expect(
      screen.getByRole('link', {
        name: 'Tasks, 3 running tasks, 2 failed tasks in the last 24 hours',
      }),
    ).toBeInTheDocument();
  });

  it('shows only the failed pill when nothing runs', async () => {
    answerCounts({ running: 0, failed: 4 });

    await renderMenu();

    await waitFor(() => expect(pill('failed')).toHaveTextContent('4'));
    expect(pill('running')).toBeNull();
    expect(
      screen.getByRole('link', {
        name: 'Tasks, 4 failed tasks in the last 24 hours',
      }),
    ).toBeInTheDocument();
  });

  it('shows no pill when both counts are zero', async () => {
    const queries = answerCounts({ running: 0, failed: 0 });

    await renderMenu();
    await waitFor(() => expect(queries).toHaveLength(2));
    await settle();

    expect(tasksLink().querySelector('.pulp-count')).toBeNull();
    expect(tasksLink()).toHaveAccessibleName('Tasks');
  });

  it('caps the number at 99+ and keeps the real number in the name', async () => {
    answerCounts({ running: 150, failed: 100 });

    await renderMenu();

    await waitFor(() => expect(pill('running')).toHaveTextContent('99+'));
    expect(pill('failed')).toHaveTextContent('99+');
    expect(
      screen.getByRole('link', {
        name: 'Tasks, 150 running tasks, 100 failed tasks in the last 24 hours',
      }),
    ).toBeInTheDocument();
  });

  it('shows 99 as 99', async () => {
    answerCounts({ running: 99, failed: 0 });

    await renderMenu();

    await waitFor(() => expect(pill('running')).toHaveTextContent(/^99/));
    expect(pill('running')).not.toHaveTextContent('99+');
  });

  it('uses the singular for one task', async () => {
    answerCounts({ running: 1, failed: 1 });

    await renderMenu();

    expect(
      await screen.findByRole('link', {
        name: 'Tasks, 1 running task, 1 failed task in the last 24 hours',
      }),
    ).toBeInTheDocument();
  });

  it('asks for the running count and for the failures of the last 24 hours, one row each', async () => {
    const queries = answerCounts({ running: 1, failed: 1 });

    await renderMenu();
    await waitFor(() => expect(queries).toHaveLength(2));

    const running = queries.find((q) => q.get('state') === 'running');
    const failed = queries.find((q) => q.get('state') === 'failed');
    expect(Object.fromEntries(running ?? [])).toEqual({
      state: 'running',
      limit: '1',
      offset: '0',
    });
    expect(Object.fromEntries(failed ?? [])).toEqual({
      state: 'failed',
      finished_at__gte: '2030-04-30T12:00:00.000Z',
      limit: '1',
      offset: '0',
    });
  });

  it('shows no pill and no spinner before the first answer', async () => {
    server.use(
      http.get(TASKS, async () => {
        await new Promise(() => undefined);
      }),
    );

    await renderMenu();

    expect(tasksLink().querySelector('.pulp-count')).toBeNull();
    expect(tasksLink().querySelector('.pf-v6-c-spinner')).toBeNull();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('hides only the failed pill when its request fails, without an error', async () => {
    answerCounts({ running: 3, failed: 'fail' });

    await renderMenu();

    await waitFor(() => expect(pill('running')).toHaveTextContent('3'));
    expect(pill('failed')).toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows no pill and no error for a user who may not list tasks', async () => {
    const queries = answerCounts({ running: 'forbidden', failed: 'forbidden' });

    await renderMenu();
    await waitFor(() => expect(queries).toHaveLength(2));
    await settle();

    expect(tasksLink().querySelector('.pulp-count')).toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('asks again after a minute while the page is in view', async () => {
    const queries = answerCounts({ running: 1, failed: 0 });

    await renderMenu();
    await waitFor(() => expect(queries).toHaveLength(2));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(COUNT_REFRESH_MS);
    });

    await waitFor(() => expect(queries).toHaveLength(4));
  });

  it('does not ask again while the page is hidden', async () => {
    const queries = answerCounts({ running: 1, failed: 0 });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });

    await renderMenu();
    await waitFor(() => expect(queries).toHaveLength(2));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(COUNT_REFRESH_MS * 3);
    });
    await settle();

    expect(queries).toHaveLength(2);
  });

  it('asks again when the route enters and leaves the Tasks screen', async () => {
    const queries = answerCounts({ running: 1, failed: 0 });

    const { user } = await renderMenu();
    await waitFor(() => expect(queries).toHaveLength(2));

    await user.click(screen.getByRole('link', { name: 'go to tasks' }));
    await waitFor(() => expect(queries).toHaveLength(4));

    await user.click(screen.getByRole('link', { name: 'go to status' }));
    await waitFor(() => expect(queries).toHaveLength(6));
  });

  it('does not ask again when the route changes within the same area', async () => {
    const queries = answerCounts({ running: 1, failed: 0 });

    const { user } = await renderMenu();
    await waitFor(() => expect(queries).toHaveLength(2));
    await user.click(screen.getByRole('link', { name: 'go to status' }));
    await settle();

    expect(queries).toHaveLength(2);
  });

  it('ignores an answer that arrives after a newer round', async () => {
    let calls = 0;
    const slow = new Promise<void>((resolve) => setTimeout(resolve, 0));
    let releaseFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    void slow;
    server.use(
      http.get(TASKS, async ({ request }) => {
        const state = new URL(request.url).searchParams.get('state');
        if (state === 'running') {
          calls += 1;
          if (calls === 1) {
            await firstGate;
            return HttpResponse.json({ count: 7, results: [] });
          }
          return HttpResponse.json({ count: 2, results: [] });
        }
        return HttpResponse.json({ count: 0, results: [] });
      }),
    );

    const { user } = await renderMenu();
    await user.click(screen.getByRole('link', { name: 'go to tasks' }));
    await waitFor(() => expect(pill('running')).toHaveTextContent('2'));

    releaseFirst();
    await settle();

    expect(pill('running')).toHaveTextContent('2');
  });
});
