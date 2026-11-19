import { act, screen, waitFor } from '@testing-library/react';
import { HttpResponse, delay, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetSessionEvents } from 'src/session/session-events';
import { listOf, repository } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import {
  SignInAgain,
  serveSignIn,
  signedIn,
} from 'src/test-utils/sign-in-again';
import { LazyRepositories } from './lazy-repositories';

const API = '/pulp/api/v3';
const REMOTE = `${API}/remotes/file/file/00000000-0000-4000-8000-0000000000aa/`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('repositories that use a remote', () => {
  it('names every repository, comma separated, and gives each a stable key', async () => {
    // React reports a missing key once per component, so the one test that
    // renders rows is also the one that checks for it.
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const rows = ['alpha', 'beta', 'gamma'].map((name) => repository({ name }));
    server.use(listOf(`${API}/repositories/file/file/`, rows).handler);

    renderWithProviders(
      <LazyRepositories plugin='file' remote_href={REMOTE} />,
    );

    expect(await screen.findByText(/alpha/)).toBeInTheDocument();
    expect(screen.getByText(/beta/)).toBeInTheDocument();
    expect(screen.getByText(/gamma/)).toBeInTheDocument();
    const keyWarnings = consoleError.mock.calls.filter((args) =>
      args.some((arg) => /unique "key" prop/.test(String(arg))),
    );
    expect(keyWarnings).toHaveLength(0);
  });

  it('shows a failure marker with the reason when the request gets no answer', async () => {
    server.use(
      http.get(`*${API}/repositories/file/file/`, () => HttpResponse.error()),
    );

    const { user } = renderWithProviders(
      <LazyRepositories plugin='file' remote_href={REMOTE} />,
    );

    const marker = await screen.findByRole('button');
    await user.hover(marker);

    expect(
      await screen.findByText(/Failed to load repositories: Network Error/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('keeps the status line in the failure reason when the server answers an error', async () => {
    server.use(
      http.get(`*${API}/repositories/file/file/`, () =>
        HttpResponse.json({}, { status: 500, statusText: 'Broken' }),
      ),
    );

    const { user } = renderWithProviders(
      <LazyRepositories plugin='file' remote_href={REMOTE} />,
    );

    await user.hover(await screen.findByRole('button'));

    expect(
      await screen.findByText(/Failed to load repositories: Error 500/),
    ).toBeInTheDocument();
  });
});

describe('repositories that use a remote after the session ended', () => {
  afterEach(() => {
    resetSessionEvents();
  });

  const refused = http.get(`*${API}/repositories/file/file/`, () =>
    HttpResponse.json({ detail: 'no' }, { status: 401 }),
  );

  function renderAfterSignIn() {
    serveSignIn();
    return renderWithProviders(
      <>
        <SignInAgain />
        <LazyRepositories plugin='file' remote_href={REMOTE} />
      </>,
      { signedIn: true },
    );
  }

  it('keeps the spinner and shows no failure marker for a 401', async () => {
    server.use(refused);
    renderAfterSignIn();
    await signedIn();
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    // the only button is the sign-in helper: no failure marker is drawn
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('reads again after the same user signs in again and names the repositories', async () => {
    server.use(refused);
    const { user } = renderAfterSignIn();
    await signedIn();
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
    server.use(
      listOf(`${API}/repositories/file/file/`, [repository({ name: 'alpha' })])
        .handler,
    );

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));

    expect(await screen.findByText(/alpha/)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('reads the shown repositories again and replaces them', async () => {
    server.use(
      listOf(`${API}/repositories/file/file/`, [repository({ name: 'alpha' })])
        .handler,
    );
    const { user } = renderAfterSignIn();
    await screen.findByText(/alpha/);
    await signedIn();
    server.use(
      listOf(`${API}/repositories/file/file/`, [repository({ name: 'beta' })])
        .handler,
    );

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));

    expect(await screen.findByText(/beta/)).toBeInTheDocument();
    expect(screen.queryByText(/alpha/)).toBeNull();
  });
});

describe('repositories that continue on a second page', () => {
  afterEach(() => {
    resetSessionEvents();
  });

  const NAMES = Array.from(
    { length: 15 },
    (_, index) => `repo-${String(index + 1).padStart(2, '0')}`,
  );
  const FIRST_PAGE = NAMES.slice(0, 10);
  const LIST = `${API}/repositories/file/file/`;

  const rows = () => NAMES.map((name) => repository({ name }));

  // the names the cell lists, in order, however it separates them
  const shown = (container: HTMLElement) =>
    (container.textContent ?? '').match(/repo-\d+/g) ?? [];

  function renderCell(remote = REMOTE) {
    serveSignIn();
    const view = renderWithProviders(
      <>
        <SignInAgain />
        <LazyRepositories plugin='file' remote_href={remote} />
      </>,
      { signedIn: true },
    );
    return view;
  }

  it('reads the first page once after signing in again and lists no repository twice', async () => {
    const list = listOf(LIST, rows(), { pageSize: 10 });
    server.use(list.handler);
    const { user, container } = renderCell();
    await screen.findByText(/repo-01/);
    await signedIn();

    await user.click(screen.getByText('(more)'));
    await screen.findByText(/repo-15/);
    expect(shown(container)).toEqual(NAMES);

    list.queries.length = 0;
    await user.click(screen.getByRole('button', { name: 'Sign in again' }));

    await waitFor(() => expect(list.queries).toHaveLength(1));
    expect(list.queries[0].get('offset') ?? '0').toBe('0');
    await waitFor(() => expect(shown(container)).toEqual(FIRST_PAGE));
    expect(screen.getByText('(more)')).toBeInTheDocument();

    await user.click(screen.getByText('(more)'));
    await screen.findByText(/repo-15/);
    expect(shown(container)).toEqual(NAMES);
    expect(screen.queryByText('(more)')).toBeNull();
  });

  it('starts at the first page of a new remote', async () => {
    const OTHER = `${API}/remotes/file/file/00000000-0000-4000-8000-0000000000bb/`;
    const other = Array.from({ length: 12 }, (_, index) =>
      repository({ name: `other-${String(index + 1).padStart(2, '0')}` }),
    );
    server.use(
      listOf(LIST, [...rows(), ...other], {
        pageSize: 10,
        matching: (row, query) =>
          query.get('remote') === OTHER
            ? row.name.startsWith('other-')
            : row.name.startsWith('repo-'),
      }).handler,
    );
    const { user, container, rerender } = renderCell();
    await screen.findByText(/repo-01/);
    await user.click(screen.getByText('(more)'));
    await screen.findByText(/repo-15/);

    rerender(
      <>
        <SignInAgain />
        <LazyRepositories plugin='file' remote_href={OTHER} />
      </>,
    );

    await screen.findByText(/other-01/);
    expect(shown(container)).toEqual([]);
    expect(container.textContent).not.toMatch(/repo-/);
    expect((container.textContent ?? '').match(/other-\d+/g)).toHaveLength(10);
    expect(screen.getByText('(more)')).toBeInTheDocument();
  });

  it('ignores the answer for the previous remote when it arrives after the answer for the new one', async () => {
    const OTHER = `${API}/remotes/file/file/00000000-0000-4000-8000-0000000000bb/`;
    server.use(
      http.get(`*${LIST}`, async ({ request }) => {
        const remote = new URL(request.url).searchParams.get('remote');
        if (remote === REMOTE) {
          await delay(150);
          return HttpResponse.json({
            count: 1,
            next: null,
            previous: null,
            results: [repository({ name: 'old-remote' })],
          });
        }
        return HttpResponse.json({
          count: 1,
          next: null,
          previous: null,
          results: [repository({ name: 'new-remote' })],
        });
      }),
    );
    const { container, rerender } = renderCell();

    rerender(
      <>
        <SignInAgain />
        <LazyRepositories plugin='file' remote_href={OTHER} />
      </>,
    );

    await screen.findByText(/new-remote/);
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(container.textContent).toMatch(/new-remote/);
    expect(container.textContent).not.toMatch(/old-remote/);
  });
});
