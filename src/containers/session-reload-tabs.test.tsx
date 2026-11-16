import { act, screen, waitFor } from '@testing-library/react';
import { HttpResponse, delay, http } from 'msw';
import { type ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetSessionEvents } from 'src/session/session-events';
import {
  listOf,
  page,
  repository,
  repositoryVersion,
  user as userRecord,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import {
  SignInAgain,
  recordWrites,
  serveSignIn,
  signedIn,
} from 'src/test-utils/sign-in-again';
import { RemoteAccessTab } from './ansible-remote/tab-access';
import { RepositoryAccessTab } from './ansible-repository/tab-access';
import { CollectionVersionsTab } from './ansible-repository/tab-collection-versions';
import { RepositoryVersionsTab as AnsibleVersionsTab } from './ansible-repository/tab-repository-versions';
import { RepositoryVersionsTab as DebVersionsTab } from './deb-repository/tab-repository-versions';
import { RepositoryVersionsTab as FileVersionsTab } from './file-repository/tab-repository-versions';
import { RepositoryVersionsTab as PythonVersionsTab } from './python-repository/tab-repository-versions';
import { RepositoryVersionsTab as RpmVersionsTab } from './rpm-repository/tab-repository-versions';

// What every tab that reads data must do once the session has ended: read
// again when the same user signs in again, and show no alert and no error
// state for a read that failed only because the session ended.

const API = '/pulp/api/v3';
const ID = '00000000-0000-4000-8000-0000000000a1';

afterEach(() => {
  resetSessionEvents();
});

const refused = (path: string) =>
  http.get(`*${path}`, () =>
    HttpResponse.json({ detail: 'no' }, { status: 401 }),
  );

const failed = (path: string) =>
  http.get(`*${path}`, () =>
    HttpResponse.json({ detail: 'no' }, { status: 500 }),
  );

const pause = (ms = 80) => act(() => new Promise((r) => setTimeout(r, ms)));

const signInAgain = (user) =>
  user.click(screen.getByRole('button', { name: 'Sign in again' }));

// The tabs that show a repository version, or the list of versions.
function versionsTabTests({
  Tab,
  base,
}: {
  Tab: ComponentType<{ item; actionContext }>;
  base: string;
}) {
  const repo = { pulp_href: `${API}/${base}/${ID}/` };
  const VERSIONS = `${API}/${base}/${ID}/versions/`;
  const item = { ...repo, name: 'tools', latest_version_href: null };

  const withType = (type: string) =>
    repositoryVersion(repo, 1, {
      content_summary: {
        added: { [type]: { count: 3, href: `${API}/content/` } },
        removed: {},
        present: {},
      },
    });

  function renderTab(params: Record<string, string>) {
    serveSignIn();
    const addAlert = vi.fn();
    const tab = (shownParams: Record<string, string>) => (
      <>
        <SignInAgain />
        <Tab
          item={item}
          actionContext={{
            addAlert,
            state: { params: shownParams },
            hasPermission: () => true,
            hasObjectPermission: () => true,
            query: vi.fn(),
          }}
        />
      </>
    );
    const view = renderWithProviders(tab(params));
    return {
      addAlert,
      // the page shows another version: same tab, new address parameters
      showVersion: (number: string) =>
        view.rerender(tab({ repositoryVersion: number })),
      ...view,
    };
  }

  const serveVersion = (type: string) =>
    server.use(listOf(VERSIONS, [withType(type)]).handler);

  describe('the shown repository version', () => {
    it('is read again and replaced by the fresh one', async () => {
      serveVersion('file.alpha');
      const { user } = renderTab({ repositoryVersion: '1' });
      await screen.findByText('file.alpha');
      await signedIn();
      serveVersion('file.beta');

      await signInAgain(user);

      expect(await screen.findByText('file.beta')).toBeInTheDocument();
      expect(screen.queryByText('file.alpha')).not.toBeInTheDocument();
    });

    it('is kept, with no alert, when the read is refused with 401', async () => {
      serveVersion('file.alpha');
      const { user, addAlert } = renderTab({ repositoryVersion: '1' });
      await screen.findByText('file.alpha');
      await signedIn();
      server.use(refused(VERSIONS));

      await signInAgain(user);
      await pause();

      expect(screen.getByText('file.alpha')).toBeInTheDocument();
      expect(addAlert).not.toHaveBeenCalled();
    });

    it('keeps the spinner, with no alert, when the first read is refused, and shows the version after signing in', async () => {
      server.use(refused(VERSIONS));
      const { user, addAlert } = renderTab({ repositoryVersion: '1' });
      await signedIn();
      await pause();
      expect(screen.getByRole('progressbar')).toBeVisible();
      expect(addAlert).not.toHaveBeenCalled();
      serveVersion('file.beta');

      await signInAgain(user);

      expect(await screen.findByText('file.beta')).toBeInTheDocument();
      expect(addAlert).not.toHaveBeenCalled();
    });

    it('raises one danger alert when the read fails for another reason', async () => {
      server.use(failed(VERSIONS));
      const { addAlert } = renderTab({ repositoryVersion: '1' });

      await waitFor(() => expect(addAlert).toHaveBeenCalledTimes(1));
      expect(addAlert.mock.calls[0][0]).toMatchObject({ variant: 'danger' });
    });

    // answers by the number asked for, each after its own delay in ms; a
    // number without an entry has no such version
    const serveNumbers = (
      answers: Record<string, { type: string; wait?: number }>,
    ) =>
      server.use(
        http.get(`*${VERSIONS}`, async ({ request }) => {
          const number = new URL(request.url).searchParams.get('number');
          const answer = answers[number];
          if (answer?.wait) {
            await delay(answer.wait);
          }
          return HttpResponse.json(
            page(
              answer
                ? [
                    repositoryVersion(repo, Number(number), {
                      content_summary: {
                        added: {
                          [answer.type]: { count: 3, href: `${API}/content/` },
                        },
                        removed: {},
                        present: {},
                      },
                    }),
                  ]
                : [],
            ),
          );
        }),
      );

    it('shows the version asked for last when the answer for the earlier one arrives after it', async () => {
      serveNumbers({
        '3': { type: 'file.three', wait: 200 },
        '4': { type: 'file.four' },
      });
      const { showVersion } = renderTab({ repositoryVersion: '3' });

      showVersion('4');

      expect(await screen.findByText('file.four')).toBeInTheDocument();
      await pause(350);
      expect(screen.getByText('file.four')).toBeInTheDocument();
      expect(screen.queryByText('file.three')).not.toBeInTheDocument();
    });

    it('does not show the previous version while the next one loads', async () => {
      serveNumbers({
        '3': { type: 'file.three' },
        '4': { type: 'file.four', wait: 150 },
      });
      const { showVersion } = renderTab({ repositoryVersion: '3' });
      await screen.findByText('file.three');

      showVersion('4');

      expect(screen.queryByText('file.three')).not.toBeInTheDocument();
      expect(screen.getByRole('progressbar')).toBeVisible();
      expect(await screen.findByText('file.four')).toBeInTheDocument();
    });

    it('says the version could not be displayed, with one alert and no spinner, when no version matches', async () => {
      serveNumbers({});
      const { user, addAlert } = renderTab({ repositoryVersion: '7' });

      // the page says it once; the alert names the cause
      expect(
        await screen.findByText('Repository versions could not be displayed.'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(addAlert).toHaveBeenCalledTimes(1);
      expect(addAlert.mock.calls[0][0]).toMatchObject({
        variant: 'danger',
        title: 'Failed to find repository version',
      });

      await signedIn();
      await signInAgain(user);
      await pause();

      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(
        screen.getByText('Repository versions could not be displayed.'),
      ).toBeInTheDocument();
    });

    it('leaves the not found state when another version is shown', async () => {
      serveNumbers({ '8': { type: 'file.eight' } });
      const { showVersion } = renderTab({ repositoryVersion: '7' });
      await screen.findByText('Repository versions could not be displayed.');

      showVersion('8');

      expect(await screen.findByText('file.eight')).toBeInTheDocument();
      expect(
        screen.queryByText('Repository versions could not be displayed.'),
      ).not.toBeInTheDocument();
    });

    it('sends no write', async () => {
      serveVersion('file.alpha');
      const recorded = recordWrites();
      const { user } = renderTab({ repositoryVersion: '1' });
      await screen.findByText('file.alpha');
      await signedIn();

      await signInAgain(user);
      await pause();

      expect(recorded.writes).toEqual([`POST ${API}/login/`]);
      recorded.stop();
    });
  });

  describe('the list of versions', () => {
    const numbered = (...numbers: number[]) =>
      listOf(
        VERSIONS,
        numbers.map((n) => repositoryVersion(repo, n)),
      ).handler;

    it('is read again and shows the fresh rows', async () => {
      server.use(numbered(1));
      const { user } = renderTab({});
      await screen.findByRole('link', { name: '1' });
      await signedIn();
      server.use(numbered(9));

      await signInAgain(user);

      expect(await screen.findByRole('link', { name: '9' })).toBeVisible();
      expect(screen.queryByRole('link', { name: '1' })).toBeNull();
    });

    it('keeps its rows and shows no error state when the read is refused with 401', async () => {
      server.use(numbered(1));
      const { user, addAlert } = renderTab({});
      await screen.findByRole('link', { name: '1' });
      await signedIn();
      server.use(refused(VERSIONS));

      await signInAgain(user);
      await pause();

      expect(screen.getByRole('link', { name: '1' })).toBeVisible();
      expect(screen.queryByText(/Error 401/)).not.toBeInTheDocument();
      expect(addAlert).not.toHaveBeenCalled();
    });
  });
}

// The tabs that list the roles assigned on an object.
function accessTabTests({
  Tab,
  base,
}: {
  Tab: ComponentType<{ item; actionContext }>;
  base: string;
}) {
  const ROLES = `${API}/${base}/${ID}/list_roles/`;
  const item = { pulp_href: `${API}/${base}/${ID}/`, name: 'tools' };

  const assigned = (username: string) =>
    http.get(`*${ROLES}`, () =>
      HttpResponse.json({
        roles: [{ role: 'viewer', users: [username], groups: [] }],
      }),
    );

  function renderTab(params: Record<string, string> = {}) {
    serveSignIn();
    const addAlert = vi.fn();
    const actionContext = {
      addAlert,
      hasPermission: () => true,
      hasObjectPermission: () => true,
      state: { params },
      user: null,
    };
    return {
      addAlert,
      ...renderWithProviders(
        <>
          <SignInAgain />
          <Tab item={item} actionContext={actionContext} />
        </>,
      ),
    };
  }

  it('reads the roles again and replaces the shown ones without a loading state in between', async () => {
    server.use(assigned('ann'));
    const { user } = renderTab();
    await screen.findByText('ann');
    await signedIn();
    server.use(
      http.get(`*${ROLES}`, async () => {
        await delay(40);
        return HttpResponse.json({
          roles: [{ role: 'viewer', users: ['bob'], groups: [] }],
        });
      }),
    );

    await signInAgain(user);
    await pause(10);

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByText('ann')).toBeInTheDocument();
    expect(await screen.findByText('bob')).toBeInTheDocument();
    expect(screen.queryByText('ann')).not.toBeInTheDocument();
  });

  it('keeps the shown roles, with no alert, when the read is refused with 401', async () => {
    server.use(assigned('ann'));
    const { user, addAlert } = renderTab();
    await screen.findByText('ann');
    await signedIn();
    server.use(refused(ROLES));

    await signInAgain(user);
    await pause();

    expect(screen.getByText('ann')).toBeInTheDocument();
    expect(
      screen.queryByText('There are currently no owners assigned.'),
    ).not.toBeInTheDocument();
    expect(addAlert).not.toHaveBeenCalled();
  });

  it('keeps the spinner and no empty state when the first read is refused, and shows the roles after signing in', async () => {
    server.use(refused(ROLES));
    const { user } = renderTab();
    await signedIn();
    await pause();
    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(
      screen.queryByText('There are currently no owners assigned.'),
    ).not.toBeInTheDocument();
    server.use(assigned('bob'));

    await signInAgain(user);

    expect(await screen.findByText('bob')).toBeInTheDocument();
  });

  it('keeps the shown roles and shows one alert when the read after signing in fails for another reason', async () => {
    server.use(assigned('ann'));
    const { user, addAlert } = renderTab();
    await screen.findByText('ann');
    await signedIn();
    server.use(failed(ROLES));

    await signInAgain(user);
    await waitFor(() => expect(addAlert).toHaveBeenCalledTimes(1));
    await pause();

    expect(addAlert).toHaveBeenCalledTimes(1);
    expect(addAlert.mock.calls[0][0].title).toBe(
      'Roles list could not be displayed.',
    );
    expect(screen.getByText('ann')).toBeInTheDocument();
    expect(
      screen.queryByText('Roles list could not be displayed.'),
    ).not.toBeInTheDocument();
  });

  it('selects the user named in the address after signing in, when its lookup was refused before', async () => {
    server.use(assigned('ann'), refused(`${API}/users/`));
    const { user, addAlert } = renderTab({ user: 'ann' });
    await screen.findByText('ann');
    await signedIn();
    await pause();
    expect(screen.queryByRole('heading', { name: 'User ann' })).toBeNull();
    server.use(
      http.get(`*${API}/users/`, () =>
        HttpResponse.json(page([userRecord({ username: 'ann' })])),
      ),
    );

    await signInAgain(user);

    expect(
      await screen.findByRole('heading', { name: 'User ann' }),
    ).toBeInTheDocument();
    expect(addAlert).not.toHaveBeenCalled();
  });

  it('leaves no unhandled rejection when the lookup of the selected user is refused with 401', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      server.use(assigned('ann'), refused(`${API}/users/`));
      renderTab({ user: 'ann' });
      await screen.findByText('ann');
      await pause(120);
    } finally {
      process.off('unhandledRejection', unhandled);
    }

    expect(unhandled).not.toHaveBeenCalled();
  });
}

describe('the file repository versions tab', () => {
  versionsTabTests({ Tab: FileVersionsTab, base: 'repositories/file/file' });
});

describe('the deb repository versions tab', () => {
  versionsTabTests({ Tab: DebVersionsTab, base: 'repositories/deb/apt' });
});

describe('the rpm repository versions tab', () => {
  versionsTabTests({ Tab: RpmVersionsTab, base: 'repositories/rpm/rpm' });
});

describe('the python repository versions tab', () => {
  versionsTabTests({
    Tab: PythonVersionsTab,
    base: 'repositories/python/python',
  });
});

describe('the ansible repository versions tab', () => {
  versionsTabTests({
    Tab: AnsibleVersionsTab,
    base: 'repositories/ansible/ansible',
  });
});

describe('the ansible collection versions tab', () => {
  const COLLECTION_VERSIONS = `${API}/content/ansible/collection_versions/`;
  const repo = repository({
    name: 'zz-test-repo',
    pulp_href: `${API}/repositories/ansible/ansible/${ID}/`,
  });
  const item = {
    ...repo,
    latest_version_href: repositoryVersion(repo, 2).pulp_href,
  };
  const row = (name: string) => ({
    pulp_href: `${API}/content/ansible/collection_versions/${name}/`,
    namespace: 'ns',
    name,
    version: '1.0.0',
    description: `The ${name} collection`,
  });

  function renderTab(shown = item) {
    serveSignIn();
    const addAlert = vi.fn();
    const tab = (current) => (
      <>
        <SignInAgain />
        <CollectionVersionsTab
          item={current}
          actionContext={{
            addAlert,
            hasPermission: () => true,
            hasObjectPermission: () => true,
            query: vi.fn(),
            state: { params: {} },
          }}
        />
      </>
    );
    const view = renderWithProviders(tab(shown));
    return { addAlert, ...view, showAgain: (next) => view.rerender(tab(next)) };
  }

  it('reads the list again and shows the fresh rows', async () => {
    server.use(listOf(COLLECTION_VERSIONS, [row('alpha')]).handler);
    const { user } = renderTab();
    await screen.findByText('The alpha collection');
    await signedIn();
    server.use(listOf(COLLECTION_VERSIONS, [row('beta')]).handler);

    await signInAgain(user);

    expect(await screen.findByText('The beta collection')).toBeVisible();
    expect(screen.queryByText('The alpha collection')).toBeNull();
  });

  it('reads the list for the new latest version when the repository page shows a newer one', async () => {
    const queries = listOf(COLLECTION_VERSIONS, [row('alpha')], {
      matching: (_row, query) =>
        query.get('repository_version') === item.latest_version_href,
    });
    server.use(queries.handler);
    const { showAgain } = renderTab();
    await screen.findByText('The alpha collection');
    const newer = repositoryVersion(repo, 3).pulp_href;
    server.use(
      listOf(COLLECTION_VERSIONS, [row('gamma')], {
        matching: (_row, query) => query.get('repository_version') === newer,
      }).handler,
    );

    showAgain({ ...item, latest_version_href: newer });

    expect(await screen.findByText('The gamma collection')).toBeVisible();
  });

  it('keeps its rows and shows no error state when the read is refused with 401', async () => {
    server.use(listOf(COLLECTION_VERSIONS, [row('alpha')]).handler);
    const { user, addAlert } = renderTab();
    await screen.findByText('The alpha collection');
    await signedIn();
    server.use(refused(COLLECTION_VERSIONS));

    await signInAgain(user);
    await pause();

    expect(screen.getByText('The alpha collection')).toBeVisible();
    expect(screen.queryByText(/Error 401/)).not.toBeInTheDocument();
    expect(addAlert).not.toHaveBeenCalled();
  });

  it('keeps the spinner and no empty state when the first read is refused', async () => {
    server.use(refused(COLLECTION_VERSIONS));
    renderTab();
    await signedIn();
    await pause();

    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(screen.queryByText('No collection versions yet')).toBeNull();
    expect(screen.queryByText(/Error 401/)).not.toBeInTheDocument();
  });
});

describe('the ansible repository access tab', () => {
  accessTabTests({
    Tab: RepositoryAccessTab,
    base: 'repositories/ansible/ansible',
  });
});

describe('the ansible remote access tab', () => {
  accessTabTests({ Tab: RemoteAccessTab, base: 'remotes/ansible/collection' });
});
