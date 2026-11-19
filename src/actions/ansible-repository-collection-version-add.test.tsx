import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { type ReactNode, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetSessionEvents } from 'src/session/session-events';
import { listOf, page, repository, task } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import {
  SignInAgain,
  serveSignIn,
  signedIn,
} from 'src/test-utils/sign-in-again';
import { ansibleRepositoryCollectionVersionAddAction } from './ansible-repository-collection-version-add';

const API = '/pulp/api/v3';
const TASK_HREF = `${API}/tasks/00000000-0000-4000-8000-0000000000aa/`;

// A row of the plain content listing of collection versions: flat, with no
// repository and no nested collection version.
const row = (overrides: Record<string, unknown> = {}) => ({
  pulp_href: `${API}/content/ansible/collection_versions/00000000-0000-4000-8000-0000000000b1/`,
  namespace: 'ns',
  name: 'col',
  version: '1.0.0',
  description: 'A test collection',
  ...overrides,
});

// The page around the dialog: it holds the state the repository tab holds,
// opens the dialog for the repository and shows the alerts the dialog raises.
function Page({
  repo,
  reloadPage,
}: {
  repo: { name: string; pulp_href: string; latest_version_href?: string };
  reloadPage: () => void;
}) {
  const [state, setState] = useState({
    repository: repo,
    addCollectionVersionModal: {
      repositoryHref: repo.pulp_href,
      repositoryName: repo.name,
      latestVersionHref: repo.latest_version_href ?? null,
    },
  });
  const [alerts, setAlerts] = useState<{ title: ReactNode }[]>([]);

  return (
    <>
      <ul aria-label='alerts'>
        {alerts.map((alert, index) => (
          <li key={index}>{alert.title}</li>
        ))}
      </ul>
      <SignInAgain />
      {ansibleRepositoryCollectionVersionAddAction.modal({
        addAlert: (alert) => setAlerts((all) => [...all, alert]),
        listQuery: () => undefined,
        query: () => undefined,
        reloadPage,
        setState,
        state,
      })}
    </>
  );
}

// Serves the collection versions of the server, records the modify requests
// and answers the task of a modify with the given state. A modify answers
// after `modifyDelay` milliseconds.
//
// `held` lists the hrefs the latest version of the repository holds; the
// content read of the dialog (the one that names a repository version) is
// answered from it. `contentHandler` replaces that answer. `latestVersion`
// null makes a repository that has no version yet.
const REPO_HREF = `${API}/repositories/ansible/ansible/00000000-0000-4000-8000-0000000000a1/`;
const LATEST = `${REPO_HREF}versions/3/`;
const COLLECTIONS = `${API}/content/ansible/collection_versions/`;

const isContentRead = (request: Request) =>
  new URL(request.url).searchParams.has('repository_version');

function setup(
  rows: { pulp_href: string }[],
  {
    taskState = 'completed',
    modifyDelay = 0,
    held = [],
    latestVersion = LATEST,
    contentHandler,
    signedIn = false,
  }: {
    taskState?: string;
    modifyDelay?: number;
    held?: string[];
    latestVersion?: string | null;
    contentHandler?: ReturnType<typeof http.get>;
    signedIn?: boolean;
  } = {},
) {
  const repo = repository({
    name: 'r1',
    pulp_href: REPO_HREF,
    latest_version_href: latestVersion as string,
  });
  const modifies: { path: string; body: unknown }[] = [];
  const contentReads: URLSearchParams[] = [];

  const list = listOf(COLLECTIONS, rows);
  server.use(
    ...(contentHandler ? [contentHandler] : []),
    http.get(`*${COLLECTIONS}`, ({ request }) => {
      if (!isContentRead(request)) {
        return undefined;
      }
      const query = new URL(request.url).searchParams;
      contentReads.push(query);
      const wanted = (query.get('pulp_href__in') ?? '').split(',');
      return HttpResponse.json(
        page(
          rows.filter(
            ({ pulp_href }) =>
              held.includes(pulp_href) && wanted.includes(pulp_href),
          ),
        ),
      );
    }),
    list.handler,
    http.post(
      `*${API}/repositories/ansible/ansible/:id/modify/`,
      async ({ request }) => {
        modifies.push({
          path: new URL(request.url).pathname,
          body: await request.json(),
        });
        await new Promise((resolve) => setTimeout(resolve, modifyDelay));
        return HttpResponse.json({ task: TASK_HREF }, { status: 202 });
      },
    ),
    http.get(`*${TASK_HREF}`, () =>
      HttpResponse.json(
        task({
          pulp_href: TASK_HREF,
          state: taskState,
          error: taskState === 'failed' ? { description: 'Task broke.' } : null,
        }),
      ),
    ),
  );
  const reloadPage = vi.fn();

  const view = renderWithProviders(
    <Page repo={repo} reloadPage={reloadPage} />,
    { signedIn },
  );

  return {
    repo,
    queries: list.queries,
    contentReads,
    modifies,
    reloadPage,
    ...view,
  };
}

const selectButton = () => screen.getByRole('button', { name: 'Select' });

afterEach(() => {
  resetSessionEvents();
});

// Three versions on one page: A and C are new to the repository, B is held.
const A = row({
  pulp_href: `${COLLECTIONS}00000000-0000-4000-8000-0000000000c1/`,
  name: 'alpha',
  version: '1.0.0',
});
const B = row({
  pulp_href: `${COLLECTIONS}00000000-0000-4000-8000-0000000000c2/`,
  name: 'beta',
  version: '2.0.0',
});
const C = row({
  pulp_href: `${COLLECTIONS}00000000-0000-4000-8000-0000000000c3/`,
  name: 'gamma',
  version: '3.0.0',
});

const heldName = 'ns.beta v2.0.0, already in the repository';
const checkboxOf = (name: string) => screen.getByRole('checkbox', { name });

// The dialog offers a row only once it knows what the repository holds.
const offered = (name: string) =>
  waitFor(() => expect(checkboxOf(name)).toBeEnabled());

describe('the add collection dialog of an ansible repository', () => {
  it('lists the collection versions of the server as flat rows without a repository column', async () => {
    setup([row()]);

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('ns.col v1.0.0')).toBeTruthy();
    expect(within(dialog).getByText('A test collection')).toBeTruthy();
    expect(
      within(dialog).queryByRole('columnheader', { name: 'Repository' }),
    ).toBeNull();
  });

  it('asks the server only for parameters the endpoint accepts', async () => {
    const { queries } = setup([row()]);

    await screen.findByText('ns.col v1.0.0');

    expect(queries).toHaveLength(1);
    expect(Array.from(queries[0].keys()).sort()).toEqual(['limit', 'offset']);
  });

  it('adds the selected collection version through a modify request and says what was added', async () => {
    const { user, repo, modifies } = setup([row()]);

    await screen.findByText('ns.col v1.0.0');
    await offered('ns.col v1.0.0');
    await user.click(screen.getByText('ns.col v1.0.0'));
    await user.click(selectButton());

    await waitFor(() => expect(modifies).toHaveLength(1));
    expect(modifies[0].path).toBe(`${repo.pulp_href}modify/`);
    expect(modifies[0].body).toEqual({ add_content_units: [row().pulp_href] });
    const alerts = within(await screen.findByRole('list', { name: 'alerts' }));
    expect(
      await alerts.findByText(
        'Started adding ns.col v1.0.0 to repository "r1".',
      ),
    ).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('unselects a collection version that is clicked twice', async () => {
    const { user, modifies } = setup([row()]);
    const label = await screen.findByText('ns.col v1.0.0');
    await offered('ns.col v1.0.0');

    expect(selectButton()).toBeDisabled();
    await user.click(label);
    expect(selectButton()).toBeEnabled();
    await user.click(label);
    expect(selectButton()).toBeDisabled();
    expect(modifies).toEqual([]);
  });

  it('reloads the page once the task of the add is done', async () => {
    const { user, reloadPage } = setup([row()]);

    await screen.findByText('ns.col v1.0.0');
    await offered('ns.col v1.0.0');
    await user.click(screen.getByText('ns.col v1.0.0'));
    await user.click(selectButton());

    await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
  });

  it('reports a failed task and keeps the page as it is', async () => {
    const { user, reloadPage } = setup([row()], { taskState: 'failed' });

    await screen.findByText('ns.col v1.0.0');
    await offered('ns.col v1.0.0');
    await user.click(screen.getByText('ns.col v1.0.0'));
    await user.click(selectButton());

    const alerts = within(await screen.findByRole('list', { name: 'alerts' }));
    expect(
      await alerts.findByText('Failed to add collection to repository "r1".'),
    ).toBeTruthy();
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it('sends one add request when Select is clicked twice', async () => {
    const { user, modifies } = setup([row()], { modifyDelay: 200 });

    await screen.findByText('ns.col v1.0.0');
    await offered('ns.col v1.0.0');
    await user.click(screen.getByText('ns.col v1.0.0'));
    const select = selectButton();
    await user.click(select);
    await user.click(select);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(modifies).toHaveLength(1);
  });
});

describe('the add collection dialog, for collection versions the repository holds', () => {
  it('marks a held version: disabled, unchecked, named and labelled, and a click selects nothing', async () => {
    const { user } = setup([A, B, C], { held: [B.pulp_href] });

    await screen.findByText('ns.beta v2.0.0');
    await waitFor(() => expect(checkboxOf(heldName)).toBeDisabled());
    expect(checkboxOf(heldName)).not.toBeChecked();
    expect(screen.getByText('In repository')).toBeTruthy();
    expect(checkboxOf('ns.alpha v1.0.0')).toBeEnabled();
    expect(checkboxOf('ns.gamma v3.0.0')).toBeEnabled();

    await user.click(screen.getByText('ns.beta v2.0.0'));
    await user.click(screen.getByText('In repository'));

    expect(checkboxOf(heldName)).not.toBeChecked();
    expect(selectButton()).toBeDisabled();
  });

  it('adds only what is selected and names no held version in an alert', async () => {
    const { user, modifies } = setup([A, B, C], { held: [B.pulp_href] });

    await screen.findByText('ns.alpha v1.0.0');
    await offered('ns.alpha v1.0.0');
    await user.click(screen.getByText('ns.beta v2.0.0'));
    await user.click(screen.getByText('ns.alpha v1.0.0'));
    await user.click(selectButton());

    await waitFor(() => expect(modifies).toHaveLength(1));
    expect(modifies[0].body).toEqual({ add_content_units: [A.pulp_href] });
    const alerts = within(await screen.findByRole('list', { name: 'alerts' }));
    expect(
      await alerts.findByText(
        'Started adding ns.alpha v1.0.0 to repository "r1".',
      ),
    ).toBeTruthy();
    expect(alerts.queryByText(/ns\.beta/)).toBeNull();
    expect(alerts.getAllByRole('listitem')).toHaveLength(1);
  });

  it('reads the held versions of the page from the latest version of the repository', async () => {
    const { contentReads } = setup([A, B, C], { held: [B.pulp_href] });

    await screen.findByText('ns.beta v2.0.0');
    await waitFor(() => expect(contentReads).toHaveLength(1));

    expect(contentReads[0].get('repository_version')).toBe(LATEST);
    expect(contentReads[0].get('pulp_href__in')).toBe(
      [A, B, C].map(({ pulp_href }) => pulp_href).join(','),
    );
    expect(contentReads[0].get('limit')).toBe('3');
  });

  it('marks a held version on a later page too', async () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row({
        pulp_href: `${COLLECTIONS}00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}/`,
        name: `col${String(i + 1).padStart(2, '0')}`,
      }),
    );
    const { user, contentReads } = setup(rows, {
      held: [rows[10].pulp_href],
    });

    await screen.findByText('ns.col01 v1.0.0');
    await offered('ns.col01 v1.0.0');
    expect(screen.queryByText('In repository')).toBeNull();

    await user.click(
      screen.getAllByRole('button', { name: /go to next page/i })[0],
    );

    await screen.findByText('ns.col11 v1.0.0');
    await waitFor(() =>
      expect(
        checkboxOf('ns.col11 v1.0.0, already in the repository'),
      ).toBeDisabled(),
    );
    expect(checkboxOf('ns.col12 v1.0.0')).toBeEnabled();
    expect(contentReads).toHaveLength(2);
    expect(contentReads[1].get('pulp_href__in')).toBe(
      [rows[10], rows[11]].map(({ pulp_href }) => pulp_href).join(','),
    );
  });

  it('follows only the newest page when the answers arrive out of order, so a held version is never offered', async () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row({
        pulp_href: `${COLLECTIONS}00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}/`,
        name: `col${String(i + 1).padStart(2, '0')}`,
      }),
    );
    const { user, modifies } = setup(rows, { held: [rows[10].pulp_href] });
    await screen.findByText('ns.col01 v1.0.0');
    await offered('ns.col01 v1.0.0');

    // The next list answer for page 1 and every content read for page 2 wait.
    const hold = () => {
      let release: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      return { released, release: () => release() };
    };
    const olderPage = hold();
    const contentOfPageTwo = hold();
    let startedForPageTwo = 0;
    server.use(
      http.get(`*${COLLECTIONS}`, async ({ request }) => {
        const query = new URL(request.url).searchParams;
        if (isContentRead(request)) {
          if ((query.get('pulp_href__in') ?? '').includes(rows[10].pulp_href)) {
            startedForPageTwo += 1;
            await contentOfPageTwo.released;
          }
        } else if (query.get('offset') === '0') {
          await olderPage.released;
        }
        return undefined;
      }),
    );

    // page 2, back to page 1 (its answer is held), and page 2 again
    await user.click(
      screen.getAllByRole('button', { name: /go to next page/i })[0],
    );
    await screen.findByText('ns.col11 v1.0.0');
    await user.click(
      screen.getAllByRole('button', { name: /go to previous page/i })[0],
    );
    await user.click(
      screen.getAllByRole('button', { name: /go to next page/i })[0],
    );
    await waitFor(() => expect(startedForPageTwo).toBe(2));

    // the answer for page 1 arrives last, then the content of page 2
    olderPage.release();
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    contentOfPageTwo.release();

    await waitFor(() =>
      expect(
        checkboxOf('ns.col11 v1.0.0, already in the repository'),
      ).toBeDisabled(),
    );
    await offered('ns.col12 v1.0.0');
    await user.click(screen.getByText('ns.col11 v1.0.0'));
    await user.click(screen.getByText('ns.col12 v1.0.0'));
    await user.click(selectButton());

    await waitFor(() => expect(modifies).toHaveLength(1));
    expect(modifies[0].body).toEqual({
      add_content_units: [rows[11].pulp_href],
    });
  });

  it('marks nothing and reads nothing for a repository without a version', async () => {
    const { contentReads } = setup([A, B], { latestVersion: null });

    await screen.findByText('ns.beta v2.0.0');
    await offered('ns.beta v2.0.0');

    expect(contentReads).toEqual([]);
    expect(screen.queryByText('In repository')).toBeNull();
  });

  it('keeps Select disabled with an empty selection when every row of the page is held', async () => {
    const { user } = setup([A, B], { held: [A.pulp_href, B.pulp_href] });

    await screen.findByText('ns.alpha v1.0.0');
    await waitFor(() =>
      expect(screen.getAllByText('In repository')).toHaveLength(2),
    );
    await user.click(screen.getByText('ns.alpha v1.0.0'));
    await user.click(screen.getByText('ns.beta v2.0.0'));

    expect(selectButton()).toBeDisabled();
    expect(
      screen.queryByText('The repository content could not be read'),
    ).toBeNull();
  });
});

describe('the add collection dialog, while it does not know what the repository holds', () => {
  const failedTitle = 'The repository content could not be read';
  const retryName = 'Retry loading the repository content';

  it('disables every checkbox and Select and marks the table busy while the content is read', async () => {
    let release: () => void = vi.fn();
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { user } = setup([A, B], {
      held: [B.pulp_href],
      contentHandler: http.get(`*${COLLECTIONS}`, async ({ request }) => {
        if (!isContentRead(request)) {
          return undefined;
        }
        await gate;
        return undefined;
      }),
    });

    await screen.findByText('ns.alpha v1.0.0');
    const table = screen.getByRole('grid', { name: 'Collection versions' });
    expect(table).toHaveAttribute('aria-busy', 'true');
    expect(checkboxOf('ns.alpha v1.0.0')).toBeDisabled();
    expect(checkboxOf('ns.beta v2.0.0')).toBeDisabled();
    await user.click(screen.getByText('ns.alpha v1.0.0'));
    expect(checkboxOf('ns.alpha v1.0.0')).not.toBeChecked();
    expect(selectButton()).toBeDisabled();

    release();

    await offered('ns.alpha v1.0.0');
    expect(table).toHaveAttribute('aria-busy', 'false');
    expect(checkboxOf(heldName)).toBeDisabled();
  });

  it('says so with a way to retry when the content cannot be read, and offers nothing until a retry works', async () => {
    let failures = 1;
    const { user, contentReads } = setup([A, B], {
      held: [B.pulp_href],
      contentHandler: http.get(`*${COLLECTIONS}`, ({ request }) => {
        if (!isContentRead(request) || failures-- <= 0) {
          return undefined;
        }
        return HttpResponse.json({ detail: 'broken' }, { status: 500 });
      }),
    });

    const alert = await screen.findByText(failedTitle);
    expect(alert).toBeTruthy();
    expect(
      screen.getByText(
        'Collections already in the repository cannot be marked, so none can be selected yet.',
      ),
    ).toBeTruthy();
    expect(checkboxOf('ns.alpha v1.0.0')).toBeDisabled();
    expect(checkboxOf('ns.beta v2.0.0')).toBeDisabled();
    await user.click(screen.getByText('ns.alpha v1.0.0'));
    expect(selectButton()).toBeDisabled();
    expect(
      screen.getByRole('grid', { name: 'Collection versions' }),
    ).toHaveAttribute('aria-busy', 'false');

    await user.click(screen.getByRole('button', { name: retryName }));

    await offered('ns.alpha v1.0.0');
    expect(screen.queryByText(failedTitle)).toBeNull();
    expect(checkboxOf(heldName)).toBeDisabled();
    // the refused read never reached the recording handler; the retry did
    expect(contentReads).toHaveLength(1);
    await user.click(screen.getByText('ns.alpha v1.0.0'));
    expect(selectButton()).toBeEnabled();
  });

  it('shows no alert and keeps everything unavailable when the read is refused with 401, then marks after signing in again', async () => {
    serveSignIn();
    const { user } = setup([A, B], {
      held: [B.pulp_href],
      contentHandler: http.get(`*${COLLECTIONS}`, ({ request }) =>
        isContentRead(request)
          ? HttpResponse.json({ detail: 'no' }, { status: 401 })
          : undefined,
      ),
      signedIn: true,
    });

    await screen.findByText('ns.alpha v1.0.0');
    await signedIn();
    await act(() => new Promise((r) => setTimeout(r, 80)));

    expect(screen.queryByText(failedTitle)).toBeNull();
    expect(checkboxOf('ns.alpha v1.0.0')).toBeDisabled();
    expect(selectButton()).toBeDisabled();
    expect(
      screen.getByRole('grid', { name: 'Collection versions' }),
    ).toHaveAttribute('aria-busy', 'true');

    server.use(
      http.get(`*${COLLECTIONS}`, ({ request }) =>
        isContentRead(request) ? HttpResponse.json(page([B])) : undefined,
      ),
    );
    await user.click(
      screen.getByRole('button', { name: 'Sign in again', hidden: true }),
    );

    await waitFor(() => expect(checkboxOf(heldName)).toBeDisabled());
    await offered('ns.alpha v1.0.0');
  });
});
