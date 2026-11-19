import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  reportUnauthorized,
  resetSessionEvents,
} from 'src/session/session-events';
import { type IIntervals, trackIntervals } from 'src/test-utils/intervals';
import { serveUserRecords } from 'src/test-utils/permissions';
import { type ITask, task } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { SignInAgain, serveSignIn } from 'src/test-utils/sign-in-again';
import { useUserContext } from 'src/user-context';
import {
  NOTIFICATIONS_REFRESH_MS,
  NOTIFICATIONS_SEEN_KEY,
  NotificationBell,
  NotificationPanel,
  NotificationsProvider,
  useNotificationsOpen,
} from './notifications';
import { Shell } from './shell';

const TASKS = '*/pulp/api/v3/tasks/';
const NOW = new Date('2030-05-01T12:00:00.000Z');
const SEEN = 'pulp-notifications-seen';

function signIn() {
  serveSignIn();
  serveUserRecords({ id: 1, isStaff: true });
  server.use(
    http.get('*/pulp/api/v3/login/', () =>
      HttpResponse.json({
        username: 'zoe',
        pulp_href: '/pulp/api/v3/users/1/',
      }),
    ),
  );
}

// A task that ended the given number of minutes before NOW.
function ended(state: string, minutesAgo: number, name = `task-${state}`) {
  return task({
    state,
    name,
    finished_at: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
  });
}

type Answer = ITask[] | 'fail' | 'forbidden' | 'unauthorized';

// Answers the notification list request, recording its query; the count
// requests of the Tasks entry are answered with zero.
function answerWith(answer: () => Answer) {
  const queries: URLSearchParams[] = [];
  server.use(
    http.get(TASKS, ({ request }) => {
      const query = new URL(request.url).searchParams;
      if (!query.has('state__in')) {
        return HttpResponse.json({ count: 0, results: [] });
      }
      queries.push(new URLSearchParams(query));
      const result = answer();
      if (result === 'fail') {
        return HttpResponse.json({ detail: 'boom' }, { status: 500 });
      }
      if (result === 'forbidden') {
        return HttpResponse.json({ detail: 'no' }, { status: 403 });
      }
      if (result === 'unauthorized') {
        return HttpResponse.json({ detail: 'no' }, { status: 401 });
      }
      return HttpResponse.json({
        count: result.length,
        next: null,
        previous: null,
        results: result,
      });
    }),
  );
  return queries;
}

const serve = (rows: Answer) => answerWith(() => rows);

function OtherAccount() {
  const { setUser } = useUserContext();

  return (
    <button
      type='button'
      onClick={() =>
        setUser({ username: 'other', pulp_href: '/pulp/api/v3/users/2/' })
      }
    >
      other account
    </button>
  );
}

function renderShell() {
  signIn();
  return renderWithProviders(
    <>
      <OtherAccount />
      <SignInAgain />
      <Shell>
        <h1>Screen title</h1>
      </Shell>
    </>,
    { route: '/status' },
  );
}

const bell = () => screen.findByRole('button', { name: /^Notifications/ });

// The page mounts the content of the panel when its slide ends, which the test
// DOM never reports; this reports it.
function finishSlide() {
  const panel = document.querySelector('.pf-v6-c-drawer__panel');
  fireEvent.transitionEnd(panel as Element);
}

async function openPanel() {
  const view = renderShell();
  const toggle = await bell();
  await view.user.click(toggle);
  finishSlide();
  return { ...view, toggle };
}

const items = () =>
  Array.from(
    document.querySelectorAll('.pf-v6-c-notification-drawer__list-item'),
  );

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

let intervals: IIntervals;

// Runs the refresh interval of the list, as the timer would after a minute.
const refreshNow = () => intervals.run(NOTIFICATIONS_REFRESH_MS);

describe('notifications', () => {
  beforeEach(() => {
    // Only the clock is faked: the polling of the test library and the mock
    // server need real timers. The refresh interval is run by hand.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    intervals = trackIntervals();
  });

  afterEach(() => {
    intervals.restore();
    vi.useRealTimers();
    resetSessionEvents();
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('asks for the ended tasks of the last 7 days, newest first, 20 at most, and nothing else', async () => {
    const queries = serve([]);

    renderShell();
    await waitFor(() => expect(queries).toHaveLength(1));

    const query = queries[0];
    expect(Array.from(query.keys()).sort()).toEqual([
      'finished_at__gte',
      'limit',
      'offset',
      'ordering',
      'state__in',
    ]);
    expect(query.get('state__in')).toBe('failed,completed,canceled');
    expect(query.get('ordering')).toBe('-finished_at');
    expect(query.get('limit')).toBe('20');
    expect(query.get('offset')).toBe('0');
    expect(query.get('finished_at__gte')).toBe('2030-04-24T12:00:00.000Z');
  });

  describe('unread', () => {
    it('stores now on a first visit and shows nothing as unread', async () => {
      serve([ended('failed', 5), ended('completed', 60)]);

      renderShell();

      const toggle = await bell();
      await waitFor(() =>
        expect(window.localStorage.getItem(SEEN)).toBe(NOW.toISOString()),
      );
      expect(toggle).toHaveAccessibleName('Notifications');
      expect(toggle).toHaveTextContent('');
    });

    it('counts the tasks that ended after the stored time', async () => {
      window.localStorage.setItem(
        NOTIFICATIONS_SEEN_KEY,
        new Date(NOW.getTime() - 45 * 60_000).toISOString(),
      );
      serve([ended('failed', 30), ended('completed', 90)]);

      renderShell();

      const toggle = await screen.findByRole('button', {
        name: 'Notifications, 1 unread notification',
      });
      expect(toggle).toHaveTextContent('1');
      expect(toggle).toHaveClass('pf-m-attention');
    });

    it('treats a stored value that is not a time as a first visit', async () => {
      window.localStorage.setItem(NOTIFICATIONS_SEEN_KEY, 'yesterday-ish');
      serve([ended('failed', 30)]);

      renderShell();

      const toggle = await bell();
      await waitFor(() =>
        expect(window.localStorage.getItem(SEEN)).toBe(NOW.toISOString()),
      );
      expect(toggle).toHaveAccessibleName('Notifications');
    });

    it('stores now on opening, empties the badge and keeps the unread marks until the panel closes', async () => {
      window.localStorage.setItem(
        NOTIFICATIONS_SEEN_KEY,
        new Date(NOW.getTime() - 45 * 60_000).toISOString(),
      );
      serve([ended('failed', 30, 'newer'), ended('completed', 90, 'older')]);
      const { user, toggle } = await openPanel();

      expect(window.localStorage.getItem(SEEN)).toBe(NOW.toISOString());
      expect(toggle).toHaveAccessibleName('Notifications');
      expect(toggle).toHaveTextContent('');

      await waitFor(() => expect(items()).toHaveLength(2));
      const [newer, older] = items();
      expect(newer).not.toHaveClass('pf-m-read');
      expect(older).toHaveClass('pf-m-read');

      await user.click(
        screen.getByRole('button', { name: 'Close notifications' }),
      );
      finishSlide();
      await user.click(toggle);
      finishSlide();

      await waitFor(() => expect(items()).toHaveLength(2));
      expect(
        items().every((item) => item.classList.contains('pf-m-read')),
      ).toBe(true);
    });

    it('shows 99+ above 99 and names the real number', async () => {
      window.localStorage.setItem(
        NOTIFICATIONS_SEEN_KEY,
        new Date(NOW.getTime() - 1000 * 60_000).toISOString(),
      );
      serve(Array.from({ length: 120 }, () => ended('failed', 5)));

      renderShell();

      const toggle = await screen.findByRole('button', {
        name: 'Notifications, 120 unread notifications',
      });
      expect(toggle).toHaveTextContent('99+');
    });

    it('shows no count and no spinner before the first answer', async () => {
      server.use(
        http.get(TASKS, async () => {
          await new Promise(() => undefined);
        }),
      );

      renderShell();

      const toggle = await bell();
      expect(toggle).toHaveAccessibleName('Notifications');
      expect(toggle).toHaveTextContent('');
      expect(toggle.querySelector('.pf-v6-c-spinner')).toBeNull();
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });
  });

  describe('items', () => {
    it('shows the variant, the name, the outcome with the time and a link to the task', async () => {
      const failed = ended('failed', 3, 'pulpcore.app.tasks.sync');
      serve([failed, ended('completed', 180), ended('canceled', 60 * 30)]);
      await openPanel();

      await waitFor(() => expect(items()).toHaveLength(3));
      const [first, second, third] = items();
      expect(first).toHaveClass('pf-m-danger');
      expect(second).toHaveClass('pf-m-success');
      expect(third).toHaveClass('pf-m-info');

      const link = within(first as HTMLElement).getByRole('link', {
        name: 'pulpcore.app.tasks.sync',
      });
      const id = failed.pulp_href.split('/').filter(Boolean).pop();
      expect(link).toHaveAttribute('href', `/tasks/${id}/`);
      expect(link).toHaveAttribute('title', 'pulpcore.app.tasks.sync');
      expect(first).toHaveTextContent('Failed 3 minutes ago');
      expect(second).toHaveTextContent('Completed 3 hours ago');
      expect(third).toHaveTextContent('Canceled yesterday');
    });

    it('renders a task name with markup as text', async () => {
      serve([ended('failed', 3, '<img src=x onerror=alert(1)>')]);
      await openPanel();

      await waitFor(() => expect(items()).toHaveLength(1));
      expect(
        within(items()[0] as HTMLElement).getByRole('link', {
          name: '<img src=x onerror=alert(1)>',
        }),
      ).toBeInTheDocument();
      expect(document.querySelector('img[src=x]')).toBeNull();
    });

    it('has the title, a close button and a link to all tasks in the header', async () => {
      serve([ended('failed', 3)]);
      await openPanel();

      expect(
        await screen.findByRole('heading', { name: 'Notifications' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Close notifications' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'View all tasks' }),
      ).toHaveAttribute('href', '/tasks/');
    });
  });

  describe('states', () => {
    it('explains an empty list', async () => {
      serve([]);
      await openPanel();

      expect(
        await screen.findByText('No finished tasks yet'),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'Your tasks appear here when they fail, complete or are canceled.',
        ),
      ).toBeInTheDocument();
    });

    it('says the list could not be loaded and asks again on retry', async () => {
      let answer: Answer = 'fail';
      const queries = answerWith(() => answer);
      const { user } = await openPanel();

      expect(
        await screen.findByText('Notifications could not be loaded.'),
      ).toBeInTheDocument();
      const before = queries.length;

      answer = [ended('failed', 3, 'recovered')];
      await user.click(
        screen.getByRole('button', { name: 'Retry loading notifications' }),
      );

      await waitFor(() => expect(queries.length).toBeGreaterThan(before));
      expect(
        await screen.findByRole('link', { name: 'recovered' }),
      ).toBeVisible();
    });

    it('has no bell for a user who may not list tasks', async () => {
      const queries = serve('forbidden');

      renderShell();
      await waitFor(() => expect(queries).toHaveLength(1));
      await screen.findByRole('link', { name: 'Skip to content' });
      await settle();

      expect(
        screen.queryByRole('button', { name: /^Notifications/ }),
      ).not.toBeInTheDocument();
    });

    it('has no bell when nobody is signed in', async () => {
      serve([]);

      renderWithProviders(
        <Shell>
          <h1>Screen title</h1>
        </Shell>,
        { route: '/status' },
      );
      await screen.findByRole('link', { name: 'Skip to content' });
      await settle();

      expect(
        screen.queryByRole('button', { name: /^Notifications/ }),
      ).not.toBeInTheDocument();
    });

    it('keeps the list when a later refresh fails', async () => {
      let answer: Answer = [ended('failed', 3, 'kept')];
      answerWith(() => answer);
      await openPanel();
      await screen.findByRole('link', { name: 'kept' });

      answer = 'fail';
      refreshNow();
      await settle();

      expect(screen.getByRole('link', { name: 'kept' })).toBeInTheDocument();
      expect(
        screen.queryByText('Notifications could not be loaded.'),
      ).not.toBeInTheDocument();
    });
  });

  describe('lifecycle', () => {
    const drawer = () => document.querySelector('.pf-v6-c-drawer');

    it('collapses the page when a refresh is refused while the panel is open', async () => {
      let answer: Answer = [ended('failed', 3, 'visible')];
      answerWith(() => answer);
      await openPanel();
      await screen.findByRole('link', { name: 'visible' });
      expect(drawer()).toHaveClass('pf-m-expanded');

      answer = 'forbidden';
      refreshNow();

      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: /^Notifications/ }),
        ).not.toBeInTheDocument(),
      );
      expect(drawer()).not.toHaveClass('pf-m-expanded');
    });

    it('starts the next session with a closed panel and no list', async () => {
      // The second session's answer is held back so the state in between is
      // what the new user sees first.
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let calls = 0;
      server.use(
        http.get(TASKS, async () => {
          calls++;
          if (calls > 1) {
            await gate;
          }
          const results =
            calls > 1
              ? [ended('completed', 2, 'second-user-task')]
              : [ended('failed', 3, 'first-user-task')];
          return HttpResponse.json({
            count: results.length,
            next: null,
            previous: null,
            results,
          });
        }),
      );

      const Probe = () => (
        <span data-testid='open'>{String(useNotificationsOpen())}</span>
      );
      const tree = (enabled: boolean) => (
        <NotificationsProvider enabled={enabled}>
          <Probe />
          <NotificationBell />
          <NotificationPanel />
        </NotificationsProvider>
      );
      const view = renderWithProviders(tree(true));

      await view.user.click(await bell());
      // The open click asks again; wait for the held-back answer to be pending.
      await waitFor(() => expect(calls).toBe(2));
      expect(screen.getByTestId('open')).toHaveTextContent('true');

      view.rerender(tree(false));
      view.rerender(tree(true));

      await waitFor(() => expect(calls).toBe(3));
      expect(screen.getByTestId('open')).toHaveTextContent('false');
      expect(screen.queryByText('first-user-task')).not.toBeInTheDocument();
      expect(screen.queryByText('second-user-task')).not.toBeInTheDocument();

      release();
      await settle();
      expect(screen.getByTestId('open')).toHaveTextContent('false');
    });
  });

  describe('another account', () => {
    it('shows nothing of the previous account until the read for the new one answers', async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let calls = 0;
      server.use(
        http.get(TASKS, async ({ request }) => {
          if (!new URL(request.url).searchParams.has('state__in')) {
            return HttpResponse.json({ count: 0, results: [] });
          }
          calls++;
          if (calls > 2) {
            await gate;
          }
          const results =
            calls > 2
              ? [ended('completed', 2, 'second-user-task')]
              : [ended('failed', 3, 'first-user-task')];
          return HttpResponse.json({
            count: results.length,
            next: null,
            previous: null,
            results,
          });
        }),
      );
      const { user } = await openPanel();
      await screen.findByRole('link', { name: 'first-user-task' });
      serveUserRecords({ id: 2, username: 'other', isStaff: true });

      await user.click(screen.getByRole('button', { name: 'other account' }));

      await waitFor(() => expect(calls).toBe(3));
      expect(screen.queryByText('first-user-task')).not.toBeInTheDocument();
      expect(screen.queryByText('second-user-task')).not.toBeInTheDocument();

      release();
      expect(
        await screen.findByRole('link', { name: 'second-user-task' }),
      ).toBeInTheDocument();
      expect(screen.queryByText('first-user-task')).not.toBeInTheDocument();
    });
  });

  describe('keyboard', () => {
    it('moves the focus to the header on opening and back to the bell on Escape', async () => {
      serve([ended('failed', 3)]);
      const { toggle } = await openPanel();

      await waitFor(() =>
        expect(
          screen.getByRole('heading', { name: 'Notifications' }).parentElement,
        ).toHaveFocus(),
      );

      fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
      finishSlide();

      expect(toggle).toHaveFocus();
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    it('returns the focus to the bell when the close button is used', async () => {
      serve([ended('failed', 3)]);
      const { user, toggle } = await openPanel();

      await user.click(
        await screen.findByRole('button', { name: 'Close notifications' }),
      );

      expect(toggle).toHaveFocus();
    });

    it('marks the bell as expanded while the panel is open', async () => {
      serve([]);
      const { toggle } = await openPanel();

      expect(toggle).toHaveAttribute('aria-expanded', 'true');
    });
  });

  describe('refreshing', () => {
    it('asks again after a minute while the page is in view', async () => {
      const queries = serve([]);

      renderShell();
      await waitFor(() => expect(queries).toHaveLength(1));
      refreshNow();

      await waitFor(() => expect(queries).toHaveLength(2));
    });

    it('does not ask again while the page is hidden', async () => {
      const queries = serve([]);
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });

      renderShell();
      await waitFor(() => expect(queries).toHaveLength(1));
      refreshNow();
      await settle();

      expect(queries).toHaveLength(1);
    });

    it('asks again when the panel opens', async () => {
      const queries = serve([]);
      const { user } = renderShell();
      await waitFor(() => expect(queries).toHaveLength(1));

      await user.click(await bell());

      await waitFor(() => expect(queries).toHaveLength(2));
    });
  });

  describe('while the session has ended', () => {
    it('asks for nothing at its interval or when the panel opens, and loads once after the session resumes', async () => {
      const queries = serve([ended('failed', 3, 'late')]);
      const { user } = renderShell();
      const toggle = await bell();
      await waitFor(() => expect(queries).toHaveLength(1));

      act(() => {
        reportUnauthorized('tab-return');
      });
      refreshNow();
      await user.click(toggle);
      await settle();
      expect(queries).toHaveLength(1);

      await user.click(screen.getByRole('button', { name: 'Sign in again' }));
      await waitFor(() => expect(queries).toHaveLength(2));
      await settle();
      expect(queries).toHaveLength(2);
    });

    it('keeps the bell while a request is held back', async () => {
      serve([]);
      renderShell();
      await bell();

      act(() => {
        reportUnauthorized('tab-return');
      });
      refreshNow();
      await settle();

      expect(
        screen.getByRole('button', { name: /^Notifications/ }),
      ).toBeInTheDocument();
    });

    it('treats a 401 answer as neither a refusal nor a failure: the bell stays and no error is shown', async () => {
      serve('unauthorized');
      const { user } = renderShell();
      const toggle = await bell();
      await settle();

      await user.click(toggle);
      finishSlide();
      await settle();

      expect(
        screen.queryByRole('button', { name: /^Notifications/ }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('Notifications could not be loaded.'),
      ).not.toBeInTheDocument();
    });
  });
});
