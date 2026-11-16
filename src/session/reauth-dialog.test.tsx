import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PulpAPI } from 'src/api/pulp';
import { PulpLoginAPI } from 'src/api/pulp-login';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { config } from 'src/ui-config';
import { useSessionEpoch, useUserContext } from 'src/user-context';
import { ReauthDialog } from './reauth-dialog';
import {
  isSignedIn,
  isSuspended,
  reportUnauthorized,
  resetSessionEvents,
} from './session-events';

const LOGIN_URL = '*/pulp/api/v3/login/';
const EXAMPLES_URL = '*/pulp/api/v3/examples/';

const examples = new PulpAPI();

// A screen that reads from the API on a button press and shows the epoch.
function Screen() {
  const epoch = useSessionEpoch();
  const { status } = useUserContext();
  const [readerShown, setReaderShown] = useState(true);
  const read = () => examples.http.get('examples/').catch(() => undefined);

  return (
    <>
      <p data-testid='status'>{status}</p>
      <p data-testid='epoch'>{epoch}</p>
      {readerShown ? (
        <button type='button' onClick={read}>
          Read
        </button>
      ) : null}
      <button type='button' onClick={() => setReaderShown(false)}>
        Remove the read button
      </button>
      <button
        type='button'
        onClick={() => {
          read();
          read();
          read();
        }}
      >
        Read three times
      </button>
      <input aria-label='Draft' defaultValue='' />
    </>
  );
}

function signedInAs(username = 'zoe', href = '/pulp/api/v3/users/1/') {
  server.use(
    http.get(LOGIN_URL, () => HttpResponse.json({ username, pulp_href: href })),
  );
}

// Counts what the server saw for each method and path.
function countRequests() {
  const counts: Record<string, number> = {};
  server.events.on('request:start', ({ request }) => {
    const key = `${request.method} ${new URL(request.url).pathname}`;
    counts[key] = (counts[key] ?? 0) + 1;
  });
  return counts;
}

function refuseExamples() {
  server.use(
    http.get(EXAMPLES_URL, () =>
      HttpResponse.json({ detail: 'Not authenticated.' }, { status: 401 }),
    ),
  );
}

// The session store learns of the signed-in user, and the dialog starts
// listening for a return to the tab, in effects that run after the screen shows
// the status; a report or an event sent before they ran would reach nobody.
const storeKnowsUser = () => waitFor(() => expect(isSignedIn()).toBe(true));

async function renderScreen() {
  signedInAs();
  refuseExamples();
  const rendered = renderWithProviders(
    <>
      <Screen />
      <ReauthDialog />
    </>,
  );
  // The session check has answered once the user is known.
  await waitFor(() =>
    expect(screen.getByTestId('status')).toHaveTextContent('authenticated'),
  );
  await storeKnowsUser();
  return rendered;
}

afterEach(() => {
  resetSessionEvents();
  server.events.removeAllListeners();
  config.UI_EXTERNAL_LOGIN_URI = null;
  vi.restoreAllMocks();
});

const SAME_USER = { username: 'zoe', pulp_href: '/pulp/api/v3/users/1/' };

function acceptLogin(body: object = SAME_USER) {
  server.use(
    http.post(LOGIN_URL, () => HttpResponse.json(body, { status: 201 })),
  );
}

// Opens the dialog by a refused request and returns it.
async function openByRequest(
  user: Awaited<ReturnType<typeof renderScreen>>['user'],
) {
  await user.click(screen.getByRole('button', { name: 'Read' }));
  return screen.findByRole('dialog', { name: /Sign in again/ });
}

const passwordOf = (dialog: HTMLElement) =>
  within(dialog).getByLabelText(/^password/i);
const submitOf = (dialog: HTMLElement) =>
  dialog.querySelector('button[type=submit]') as HTMLElement;

describe('sign in again dialog', () => {
  it('shows no dialog while nobody is signed in, even after a refused request', async () => {
    refuseExamples();
    const { user } = renderWithProviders(
      <>
        <Screen />
        <ReauthDialog />
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'Read' }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a refused request of a signed-in user opens the dialog named Sign in again', async () => {
    const { user } = await renderScreen();

    await user.click(screen.getByRole('button', { name: 'Read' }));

    const dialog = await screen.findByRole('dialog', { name: /Sign in again/ });
    expect(
      within(dialog).getByText('Your session has ended. Log in to continue.'),
    ).toBeVisible();
  });

  it('three refused requests at once open one dialog', async () => {
    const { user } = await renderScreen();

    await user.click(screen.getByRole('button', { name: 'Read three times' }));

    await screen.findByRole('dialog', { name: /Sign in again/ });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('signing in again as the same user sends one login request with a Basic header, closes the dialog and moves the epoch to 1', async () => {
    const { user } = await renderScreen();
    const posts: (string | null)[] = [];
    server.use(
      http.post(LOGIN_URL, ({ request }) => {
        posts.push(request.headers.get('authorization'));
        return HttpResponse.json(
          { username: 'zoe', pulp_href: '/pulp/api/v3/users/1/' },
          { status: 201 },
        );
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Read' }));
    const dialog = await screen.findByRole('dialog', { name: /Sign in again/ });

    await user.type(within(dialog).getByLabelText(/^password/i), 'secret');
    await user.click(within(dialog).getByRole('button', { name: 'Log in' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: /Sign in again/ }),
      ).not.toBeInTheDocument(),
    );
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatch(/^Basic /);
    expect(
      Buffer.from((posts[0] ?? '').slice('Basic '.length), 'base64').toString(
        'utf8',
      ),
    ).toBe('zoe:secret');
    expect(screen.getByTestId('epoch')).toHaveTextContent('1');
  });

  it('the refused request is not sent again after signing in', async () => {
    const requests = countRequests();
    const { user } = await renderScreen();
    server.use(
      http.post(LOGIN_URL, () =>
        HttpResponse.json(
          { username: 'zoe', pulp_href: '/pulp/api/v3/users/1/' },
          { status: 201 },
        ),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Read' }));
    const dialog = await screen.findByRole('dialog', { name: /Sign in again/ });
    await user.type(within(dialog).getByLabelText(/^password/i), 'secret');
    await user.click(within(dialog).getByRole('button', { name: 'Log in' }));
    await waitFor(() =>
      expect(screen.getByTestId('epoch')).toHaveTextContent('1'),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(requests['GET /pulp/api/v3/examples/']).toBe(1);
  });

  it('keeps what the user typed on the screen behind the dialog', async () => {
    const { user } = await renderScreen();
    server.use(
      http.post(LOGIN_URL, () =>
        HttpResponse.json(
          { username: 'zoe', pulp_href: '/pulp/api/v3/users/1/' },
          { status: 201 },
        ),
      ),
    );
    await user.type(screen.getByLabelText('Draft'), 'unsaved words');
    await user.click(screen.getByRole('button', { name: 'Read' }));
    const dialog = await screen.findByRole('dialog', { name: /Sign in again/ });
    await user.type(within(dialog).getByLabelText(/^password/i), 'secret');
    await user.click(within(dialog).getByRole('button', { name: 'Log in' }));
    await waitFor(() =>
      expect(screen.getByTestId('epoch')).toHaveTextContent('1'),
    );

    expect(screen.getByLabelText('Draft')).toHaveValue('unsaved words');
  });
});

describe('sign in again dialog cover', () => {
  const COVER = '.pulp-reauth__backdrop';

  it('covers the screen with its own backdrop while the dialog is open and leaves none behind', async () => {
    const { user } = await renderScreen();
    acceptLogin();
    expect(document.querySelector(COVER)).toBeNull();

    const dialog = await openByRequest(user);

    const backdrop = dialog.closest('.pf-v6-c-backdrop');
    expect(backdrop).not.toBeNull();
    expect(backdrop).toHaveClass('pulp-reauth__backdrop');

    await user.type(passwordOf(dialog), 'secret');
    await user.click(submitOf(dialog));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(document.querySelector(COVER)).toBeNull();
  });

  it('covers the screen in external login mode too', async () => {
    config.UI_EXTERNAL_LOGIN_URI = 'https://login.example/start';
    signedInAs();
    refuseExamples();
    const { user } = renderWithProviders(
      <>
        <Screen />
        <ReauthDialog />
      </>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated'),
    );
    await storeKnowsUser();

    const dialog = await openByRequest(user);

    expect(dialog.closest('.pf-v6-c-backdrop')).toHaveClass(
      'pulp-reauth__backdrop',
    );
  });

  it('keeps the screen mounted under the cover, with what was typed in it', async () => {
    const { user } = await renderScreen();
    const field = screen.getByLabelText('Draft');
    await user.type(field, 'unsaved words');

    await openByRequest(user);

    expect(document.querySelector(COVER)).not.toBeNull();
    expect(field.isConnected).toBe(true);
    expect(field).toHaveValue('unsaved words');
  });
});

describe('sign in again dialog contract', () => {
  it('opened by a request it shows the lead, the request note and the kept note in that order', async () => {
    const { user } = await renderScreen();

    const dialog = await openByRequest(user);

    const lines = Array.from(dialog.querySelectorAll('p')).map(
      (paragraph) => paragraph.textContent,
    );
    expect(lines).toEqual([
      'Your session has ended. Log in to continue.',
      'The last action was not completed. Repeat it after you log in.',
      'What you have entered on this page is kept.',
    ]);
  });

  it('opened by the tab-return check it shows no request note and leaves no gap', async () => {
    await renderScreen();

    act(() => reportUnauthorized('tab-return'));

    const dialog = await screen.findByRole('dialog', { name: /Sign in again/ });
    const lines = Array.from(dialog.querySelectorAll('p')).map(
      (paragraph) => paragraph.textContent,
    );
    expect(lines).toEqual([
      'Your session has ended. Log in to continue.',
      'What you have entered on this page is kept.',
    ]);
  });

  it('gives the lead and each note the same text class, so every sentence has the same gap below it', async () => {
    const { user } = await renderScreen();

    const dialog = await openByRequest(user);

    const paragraphs = Array.from(dialog.querySelectorAll('p'));
    expect(paragraphs).toHaveLength(3);
    for (const paragraph of paragraphs) {
      expect(paragraph).toHaveClass('pulp-reauth__text');
    }
    // The note color belongs to the notes, not to the lead sentence.
    expect(paragraphs[0]).not.toHaveClass('pulp-reauth__note');
    expect(paragraphs[1]).toHaveClass('pulp-reauth__note');
    expect(paragraphs[2]).toHaveClass('pulp-reauth__note');
    // The form follows the last sentence directly.
    expect(paragraphs[2]?.nextElementSibling?.tagName).toBe('FORM');
  });

  it('leaves no empty paragraph behind when there is no request note', async () => {
    await renderScreen();

    act(() => reportUnauthorized('tab-return'));

    const dialog = await screen.findByRole('dialog', { name: /Sign in again/ });
    const paragraphs = Array.from(dialog.querySelectorAll('p'));
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[1]?.nextElementSibling?.tagName).toBe('FORM');
  });

  it('prefills the user name, lets it be edited and puts the focus in the password field', async () => {
    const { user } = await renderScreen();
    acceptLogin({ username: 'other', pulp_href: '/pulp/api/v3/users/1/' });
    const posts: (string | null)[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'POST') {
        posts.push(request.headers.get('authorization'));
      }
    });

    const dialog = await openByRequest(user);

    const name = within(dialog).getByLabelText(/^username/i);
    expect(name).toHaveValue('zoe');
    await waitFor(() => expect(passwordOf(dialog)).toHaveFocus());
    await user.clear(name);
    await user.type(name, 'other');
    await user.type(passwordOf(dialog), 'secret');
    await user.click(submitOf(dialog));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(
      Buffer.from((posts[0] ?? '').slice('Basic '.length), 'base64').toString(
        'utf8',
      ),
    ).toBe('other:secret');
  });

  it('while signing in the fields are disabled, the button shows progress and a second submit sends nothing', async () => {
    const { user } = await renderScreen();
    let posts = 0;
    server.use(
      http.post(LOGIN_URL, async () => {
        posts += 1;
        await new Promise((resolve) => setTimeout(resolve, 100));
        return HttpResponse.json(SAME_USER, { status: 201 });
      }),
    );
    const dialog = await openByRequest(user);
    await user.type(passwordOf(dialog), 'secret');

    await user.click(submitOf(dialog));

    expect(within(dialog).getByLabelText(/^username/i)).toBeDisabled();
    expect(passwordOf(dialog)).toBeDisabled();
    expect(submitOf(dialog)).toBeDisabled();
    expect(
      dialog.querySelector('.pf-v6-c-button.pf-m-in-progress'),
    ).not.toBeNull();
    fireEvent.submit(dialog.querySelector('form') as HTMLFormElement);
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(posts).toBe(1);
  });

  it.each([
    [
      'wrong credentials',
      () => HttpResponse.json({}, { status: 401 }),
      'Invalid login credentials.',
    ],
    [
      'wrong credentials with a server text',
      () => HttpResponse.json({ detail: 'Account locked.' }, { status: 401 }),
      'Account locked.',
    ],
    [
      'a server error',
      () => HttpResponse.json({}, { status: 500 }),
      'Server error. Please come back later.',
    ],
    [
      'an unreachable server',
      () => HttpResponse.error(),
      /The server could not be reached: /,
    ],
  ])(
    'a sign-in refused by %s shows an inline line, keeps one dialog and enables the fields again',
    async (_name, answer, expected) => {
      const { user } = await renderScreen();
      server.use(http.post(LOGIN_URL, answer));
      const dialog = await openByRequest(user);
      await user.type(passwordOf(dialog), 'wrong');

      await user.click(submitOf(dialog));

      expect(await within(dialog).findByText(expected)).toBeVisible();
      await waitFor(() => expect(passwordOf(dialog)).toBeEnabled());
      expect(submitOf(dialog)).toBeEnabled();
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
      expect(isSuspended()).toBe(true);
    },
  );

  it('returns the focus to the element that had it when the dialog opened', async () => {
    const { user } = await renderScreen();
    acceptLogin();
    const reader = screen.getByRole('button', { name: 'Read' });
    reader.focus();
    const dialog = await openByRequest(user);
    await user.type(passwordOf(dialog), 'secret');

    await user.click(submitOf(dialog));

    await waitFor(() => expect(reader).toHaveFocus());
  });

  it('returns the focus to the main area when the element that had it is gone', async () => {
    const { user } = await renderScreen();
    acceptLogin();
    const main = document.createElement('div');
    main.id = 'main-content';
    main.tabIndex = -1;
    document.body.append(main);
    const reader = screen.getByRole('button', { name: 'Read' });
    reader.focus();
    const dialog = await openByRequest(user);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Remove the read button',
        hidden: true,
      }),
    );
    await user.type(passwordOf(dialog), 'secret');

    await user.click(submitOf(dialog));

    await waitFor(() => expect(main).toHaveFocus());
    main.remove();
  });

  it('a different user loads the start page afresh instead of keeping the screen', async () => {
    const { user } = await renderScreen();
    acceptLogin({ username: 'amy', pulp_href: '/pulp/api/v3/users/2/' });
    const assign = vi
      .spyOn(window.location, 'assign')
      .mockImplementation(() => undefined);
    const dialog = await openByRequest(user);
    await user.type(passwordOf(dialog), 'secret');

    await user.click(submitOf(dialog));

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(assign).toHaveBeenCalledWith('/ui/status/');
    expect(screen.getByTestId('epoch')).toHaveTextContent('0');
  });

  it('cannot be closed: no close button, Esc and a click on the backdrop leave it open', async () => {
    const { user } = await renderScreen();
    const dialog = await openByRequest(user);

    expect(
      within(dialog).queryByRole('button', { name: /close/i }),
    ).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    const backdrop = dialog.closest('.pf-v6-c-backdrop') as HTMLElement;
    await user.click(backdrop);

    expect(screen.getByRole('dialog', { name: /Sign in again/ })).toBeVisible();
  });

  it('offers the login page as the only other exit and opens it with the current address as next', async () => {
    const assign = vi
      .spyOn(window.location, 'assign')
      .mockImplementation(() => undefined);
    signedInAs();
    refuseExamples();
    const { user } = renderWithProviders(
      <>
        <Screen />
        <ReauthDialog />
      </>,
      { route: '/file/repositories?page=2' },
    );
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated'),
    );
    await storeKnowsUser();
    const dialog = await openByRequest(user);

    await user.click(
      within(dialog).getByRole('button', { name: 'Go to the login page' }),
    );

    expect(assign).toHaveBeenCalledTimes(1);
    const target = new URL(
      assign.mock.calls[0]?.[0] as string,
      'https://x.test',
    );
    expect(target.pathname).toBe('/ui/login/');
    expect(target.searchParams.get('next')).toBe('/file/repositories?page=2');
  });

  it.each(['/login', '/signed-out'])(
    'never opens on %s and resumes the session store there',
    async (route) => {
      signedInAs();
      renderWithProviders(
        <>
          <Screen />
          <ReauthDialog />
        </>,
        { route },
      );
      await waitFor(() =>
        expect(screen.getByTestId('status')).toHaveTextContent('authenticated'),
      );
      await storeKnowsUser();

      act(() => reportUnauthorized('request'));
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await waitFor(() => expect(isSuspended()).toBe(false));
    },
  );

  it('in external login mode shows no form, the external note and a Login button with the return path', async () => {
    config.UI_EXTERNAL_LOGIN_URI = 'https://login.example/start';
    signedInAs();
    refuseExamples();
    const { user } = renderWithProviders(
      <>
        <Screen />
        <ReauthDialog />
      </>,
      { route: '/file/repositories?page=2' },
    );
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated'),
    );
    await storeKnowsUser();

    const dialog = await openByRequest(user);

    expect(
      within(dialog).queryByLabelText(/^username/i),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByLabelText(/^password/i),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Your session has ended. You are taken to the login page and back to this page afterwards. Anything you entered on this page is lost.',
      ),
    ).toBeVisible();
    expect(
      within(dialog).queryByText('What you have entered on this page is kept.'),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: 'Go to the login page' }),
    ).not.toBeInTheDocument();
    const login = within(dialog).getByRole('link', { name: 'Login' });
    expect(login).toHaveAttribute(
      'href',
      `https://login.example/start?next=${encodeURIComponent('/ui/file/repositories?page=2')}`,
    );
    await waitFor(() => expect(login).toHaveFocus());
  });
});

describe('returning to the tab', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'visibilityState');
  });

  // What the browser does when the user comes back to the tab.
  function returnToTab(state: 'visible' | 'hidden' = 'visible') {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => state,
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
  const WHOAMI = 'GET /pulp/api/v3/login/';

  // Collects the who-is-signed-in calls the dialog makes. A test waits for a
  // call to finish through its promise: a fixed sleep is shorter than a slow
  // answer, and the next return to the tab would then be ignored because the
  // first check still counts as running.
  function trackChecks() {
    const checks: Promise<unknown>[] = [];
    const whoami = PulpLoginAPI.whoami;
    vi.spyOn(PulpLoginAPI, 'whoami').mockImplementation(() => {
      const check = whoami();
      checks.push(check.catch(() => undefined));
      return check;
    });
    return checks;
  }

  // Resolves once the check has answered and the code that reacts to its
  // answer has run.
  const finished = (check: Promise<unknown>) =>
    act(async () => {
      await check;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

  function answerWhoami(status: number | 'network') {
    server.use(
      http.get(LOGIN_URL, () =>
        status === 'network'
          ? HttpResponse.error()
          : HttpResponse.json({ detail: 'No.' }, { status }),
      ),
    );
  }

  it('sends one who-is-signed-in request and opens the dialog without the request note when it answers 401', async () => {
    await renderScreen();
    const counts = countRequests();
    answerWhoami(401);

    returnToTab();

    const dialog = await screen.findByRole('dialog', { name: /Sign in again/ });
    expect(counts[WHOAMI]).toBe(1);
    expect(
      within(dialog).queryByText(/The last action was not completed/),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByText('What you have entered on this page is kept.'),
    ).toBeVisible();
  });

  it('a 403 answer opens the dialog as a 401 does', async () => {
    await renderScreen();
    answerWhoami(403);

    returnToTab();

    expect(
      await screen.findByRole('dialog', { name: /Sign in again/ }),
    ).toBeVisible();
  });

  it('an answer naming another account loads the start page afresh and opens no dialog', async () => {
    await renderScreen();
    const assign = vi
      .spyOn(window.location, 'assign')
      .mockImplementation(() => undefined);
    const checks = trackChecks();
    signedInAs('amy', '/pulp/api/v3/users/2/');

    returnToTab();
    await waitFor(() => expect(checks).toHaveLength(1));
    await finished(checks[0]);

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/ui/status/');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('an answer naming another account without an address is told apart by the user name', async () => {
    await renderScreen();
    const assign = vi
      .spyOn(window.location, 'assign')
      .mockImplementation(() => undefined);
    const checks = trackChecks();
    server.use(
      http.get(LOGIN_URL, () => HttpResponse.json({ username: 'amy' })),
    );

    returnToTab();
    await waitFor(() => expect(checks).toHaveLength(1));
    await finished(checks[0]);

    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('an answer naming the same account loads nothing', async () => {
    await renderScreen();
    const assign = vi
      .spyOn(window.location, 'assign')
      .mockImplementation(() => undefined);
    const checks = trackChecks();

    returnToTab();
    await waitFor(() => expect(checks).toHaveLength(1));
    await finished(checks[0]);

    expect(assign).not.toHaveBeenCalled();
  });

  it.each([
    ['a 500 answer', 500],
    ['a network error', 'network'],
  ] as const)('%s opens nothing and adds no alert', async (_name, status) => {
    await renderScreen();
    const counts = countRequests();
    const checks = trackChecks();
    answerWhoami(status);

    returnToTab();
    await waitFor(() => expect(checks).toHaveLength(1));
    await finished(checks[0]);

    expect(counts[WHOAMI]).toBe(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(isSuspended()).toBe(false);
  });

  it('a valid session answer opens nothing', async () => {
    await renderScreen();
    const counts = countRequests();
    const checks = trackChecks();

    returnToTab();
    await waitFor(() => expect(checks).toHaveLength(1));
    await finished(checks[0]);

    expect(counts[WHOAMI]).toBe(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('several visibility changes while one check runs send one request', async () => {
    await renderScreen();
    const counts = countRequests();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(LOGIN_URL, async () => {
        await gate;
        return HttpResponse.json({ detail: 'No.' }, { status: 401 });
      }),
    );

    returnToTab();
    returnToTab();
    returnToTab();
    await settle();
    release();

    await screen.findByRole('dialog', { name: /Sign in again/ });
    expect(counts[WHOAMI]).toBe(1);
  });

  it('checks again on a later return once the first check has finished', async () => {
    await renderScreen();
    const counts = countRequests();
    const checks = trackChecks();

    returnToTab();
    await waitFor(() => expect(checks).toHaveLength(1));
    await finished(checks[0]);
    returnToTab();

    await waitFor(() => expect(counts[WHOAMI]).toBe(2));
    await finished(checks[1]);
  });

  it('sends nothing when the tab becomes hidden', async () => {
    await renderScreen();
    const counts = countRequests();

    returnToTab('hidden');
    await settle();

    expect(counts[WHOAMI]).toBeUndefined();
  });

  // The dialog opened by the check of a return to the tab, as when the
  // session was ended in another tab.
  async function dialogOpenedByReturn() {
    const rendered = await renderScreen();
    answerWhoami(401);
    returnToTab();
    await screen.findByRole('dialog', { name: /Sign in again/ });
    return rendered;
  }

  it('asks once while the dialog is open, and closes it when the same account answers', async () => {
    await dialogOpenedByReturn();
    const counts = countRequests();
    signedInAs();

    returnToTab();

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: /Sign in again/ }),
      ).not.toBeInTheDocument(),
    );
    expect(counts[WHOAMI]).toBe(1);
    expect(isSuspended()).toBe(false);
    expect(screen.getByTestId('epoch')).toHaveTextContent('1');
    expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
  });

  it('sends nothing when nobody is signed in', async () => {
    answerWhoami(401);
    const view = renderWithProviders(
      <>
        <Screen />
        <ReauthDialog />
      </>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('anonymous'),
    );
    const counts = countRequests();

    returnToTab();
    await settle();

    expect(counts[WHOAMI]).toBeUndefined();
    expect(view.container).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sends nothing on the signed-out page', async () => {
    signedInAs();
    renderWithProviders(
      <>
        <Screen />
        <ReauthDialog />
      </>,
      { route: '/signed-out' },
    );
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated'),
    );
    await storeKnowsUser();
    const counts = countRequests();

    returnToTab();
    await settle();

    expect(counts[WHOAMI]).toBeUndefined();
  });

  it('starts no timer: nothing is asked again without a return to the tab', async () => {
    await renderScreen();
    const counts = countRequests();

    await settle();

    expect(counts[WHOAMI]).toBeUndefined();
  });
});
