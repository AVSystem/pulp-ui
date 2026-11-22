import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AppContextProvider, useAppContext } from 'src/app-context';
import fileDescriptor from 'src/descriptors/file/descriptor';
import {
  API,
  DISTRIBUTIONS,
  PUBLICATIONS,
  idOf,
  serveDeleteLab,
} from 'src/test-utils/delete-lab';
import { servePermissions } from 'src/test-utils/permissions';
import {
  type IContentGuard,
  type IDistribution,
  contentGuard,
  distribution,
  listOf,
  pluginRepository,
  projectedBy,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { deleteRepositoryWithDistributions } from './delete-repository';
import type * as DeleteFlow from './delete-repository';
import { DeleteRepositoryDialog } from './delete-repository-dialog';

// The delete itself is the real one; one test makes it fail in a way only a
// programming error could.
vi.mock('./delete-repository', async (importOriginal) => {
  const actual = await importOriginal<typeof DeleteFlow>();
  return {
    ...actual,
    deleteRepositoryWithDistributions: vi.fn(
      actual.deleteRepositoryWithDistributions,
    ),
  };
});

const REPO_NAME = 'zz-test-repo';

// Serves the file plugin with the given distributions (all of them bound to
// the repository) and the guards, and records the guard requests.
function serve(
  distributions: IDistribution[],
  guards: IContentGuard[] = [],
  lab: Parameters<typeof serveDeleteLab>[0] extends infer S
    ? Partial<S>
    : never = {},
) {
  const guardQueries: URLSearchParams[] = [];
  const sent = serveDeleteLab({ distributions, runningReads: 0, ...lab });
  server.use(
    http.get(`*${API}/contentguards/`, ({ request }) => {
      guardQueries.push(new URL(request.url).searchParams);
      return HttpResponse.json({
        count: guards.length,
        next: null,
        previous: null,
        results: guards,
      });
    }),
  );
  return { ...sent, guardQueries };
}

// Holds every task read until the returned function is called, so a delete
// stays "running" for as long as a test needs.
function holdTasks() {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    http.get(`*${API}/tasks/:id/`, async ({ params }) => {
      await gate;
      return HttpResponse.json({
        pulp_href: `${API}/tasks/${params.id}/`,
        name: 'delete',
        state: 'completed',
      });
    }),
  );
  return () => act(async () => release());
}

// The titles of the alerts queued for the next screen, as that screen sees them.
const Queued = () => {
  const { alerts } = useAppContext();
  return (
    <ul data-testid='queued'>
      {alerts.map(({ title }, index) => (
        <li key={index}>{title as string}</li>
      ))}
    </ul>
  );
};

function Host({
  repo,
  onDeleted,
  onClose,
}: {
  repo: ReturnType<typeof pluginRepository>;
  onDeleted: (alert: unknown) => void;
  onClose: () => void;
}) {
  const [shown, setShown] = useState(true);

  return (
    <>
      <button onClick={() => setShown(false)}>Leave the page</button>
      <Queued />
      {shown ? (
        <DeleteRepositoryDialog
          plugin='file'
          descriptor={fileDescriptor}
          repository={repo}
          onClose={onClose}
          onDeleted={onDeleted}
        />
      ) : null}
    </>
  );
}

function renderDialog({
  repo = pluginRepository('file', { name: REPO_NAME }),
} = {}) {
  const onClose = vi.fn();
  const onDeleted = vi.fn();
  const view = renderWithProviders(
    <AppContextProvider>
      <Host repo={repo} onDeleted={onDeleted} onClose={onClose} />
    </AppContextProvider>,
  );
  return { onClose, onDeleted, repo, ...view };
}

const deleteButton = () => screen.getByRole('button', { name: /^Delete/ });
const queued = () =>
  within(screen.getByTestId('queued'))
    .queryAllByRole('listitem')
    .map((item) => item.textContent);

// the distributions are bound to the repository of the dialog
function boundTo(
  repo: { pulp_href: string },
  overrides: Partial<IDistribution>,
) {
  return distribution({ repository: repo.pulp_href, ...overrides });
}

describe(
  'Integration: the delete repository dialog',
  { tags: ['integration'] },
  () => {
    it('lists every distribution sorted by name with the URL the server reports', async () => {
      const repo = pluginRepository('file', { name: REPO_NAME });
      serve([
        boundTo(repo, {
          base_path: 'zz-second',
          base_url: 'https://pulp.example/content/served-second/',
        }),
        boundTo(repo, {
          base_path: 'aa-first',
          base_url: 'https://pulp.example/content/served-first/',
        }),
      ]);

      renderDialog({ repo });

      await screen.findByText('https://pulp.example/content/served-first/');
      const text = document.body.textContent;
      expect(text).toContain('https://pulp.example/content/served-second/');
      expect(text.indexOf('aa-first')).toBeLessThan(text.indexOf('zz-second'));
    });

    it('says a distribution with nothing to serve serves nothing, to a user who may read publications', async () => {
      const account = servePermissions({ id: 7, isStaff: true });
      const repo = pluginRepository('file', { name: REPO_NAME });
      // the repository has no publication, so the content app answers 404
      serve([boundTo(repo, { base_path: 'unpublished' })]);

      renderDialog({ repo });

      await screen.findByText('unpublished');
      expect(
        await screen.findByText('Serves nothing (404): no publication'),
      ).toBeInTheDocument();
      account.stop();
    });

    it('still lists a distribution it cannot check for a user who may not read publications, and says so instead of saying it serves nothing', async () => {
      const repo = pluginRepository('file', { name: REPO_NAME });
      serve([boundTo(repo, { base_path: 'unpublished' })]);

      renderDialog({ repo });

      await screen.findByText('unpublished');
      expect(screen.getByText('Cannot be checked')).toBeInTheDocument();
      expect(screen.queryByText(/Serves nothing/)).toBeNull();
    });

    it('marks a distribution protected by a content guard as customer-facing and names the guard, with one request for the names', async () => {
      const repo = pluginRepository('file', { name: REPO_NAME });
      const guard = contentGuard({ name: 'customers-only' });
      const open = boundTo(repo, { base_path: 'open' });
      const guarded = boundTo(repo, {
        base_path: 'guarded',
        content_guard: guard.pulp_href,
      });
      const { guardQueries } = serve([open, guarded], [guard]);

      renderDialog({ repo });

      await screen.findByText(/Guard: customers-only/);
      expect(screen.getAllByText(/Protected by a content guard/)).toHaveLength(
        1,
      );
      expect(guardQueries).toHaveLength(1);
      expect(guardQueries[0].get('pulp_href__in')).toBe(guard.pulp_href);
    });

    it('marks the distribution as guarded without a name when the guards cannot be read', async () => {
      const repo = pluginRepository('file', { name: REPO_NAME });
      const guarded = boundTo(repo, {
        base_path: 'guarded',
        content_guard: contentGuard().pulp_href,
      });
      serve([guarded]);
      server.use(
        http.get(`*${API}/contentguards/`, () =>
          HttpResponse.json({ detail: 'No.' }, { status: 403 }),
        ),
      );

      renderDialog({ repo });

      await screen.findByText(/Protected by a content guard/);
      expect(screen.queryByText(/Guard:/)).toBeNull();
    });

    it('asks no content guard question for distributions that have none', async () => {
      const repo = pluginRepository('file', { name: REPO_NAME });
      const { guardQueries } = serve([boundTo(repo, { base_path: 'open' })]);

      renderDialog({ repo });

      await screen.findByText('open');
      expect(guardQueries).toStrictEqual([]);
    });

    it('says no distribution serves a repository without one', async () => {
      serve([]);
      renderDialog();

      expect(
        await screen.findByText(
          'No distribution serves this repository. Only the repository is deleted.',
        ),
      ).toBeVisible();
    });

    it('asks for a plain confirmation with no name to type, keeps Delete off until the distributions are listed, and Cancel sends nothing', async () => {
      const sent = serve([]);
      const { onClose, user } = renderDialog();

      expect(deleteButton()).toBeDisabled();
      await screen.findByText(/No distribution serves this repository/);
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(deleteButton()).toBeEnabled();

      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(sent.deletes).toStrictEqual([]);
    });

    it('shows the spinner and disables Delete while the deletes run, and sends one set of deletes however often Delete is pressed', async () => {
      const repo = pluginRepository('file', { name: REPO_NAME });
      const sent = serve([boundTo(repo, { base_path: 'only' })]);
      const release = holdTasks();
      const { user } = renderDialog({ repo });
      await screen.findByText('only');

      await user.click(deleteButton());
      await user.click(deleteButton());

      await waitFor(() => expect(deleteButton()).toBeDisabled());
      expect(
        within(deleteButton()).getByRole('progressbar'),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(sent.deletes.length).toBeGreaterThanOrEqual(1),
      );
      expect(sent.deletes.filter((path) => path === repo.pulp_href)).toEqual(
        [],
      );
      await release();
      await waitFor(() => expect(sent.deletes).toHaveLength(2));
    });

    it('closes through the screen, never itself, when the repository is gone, handing it the success alert', async () => {
      const repo = pluginRepository('file', { name: REPO_NAME });
      const sent = serve([boundTo(repo, { base_path: 'only', name: 'only' })]);
      const { onClose, onDeleted, user } = renderDialog({ repo });
      await screen.findByText('only');

      await user.click(deleteButton());

      await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
      expect(onDeleted).toHaveBeenCalledWith({
        variant: 'success',
        title: `Removed repository ${REPO_NAME}`,
        description: 'Removed distributions: only',
      });
      expect(sent.deletes).toStrictEqual([sent.deletes[0], repo.pulp_href]);
      expect(onClose).not.toHaveBeenCalled();
      expect(queued()).toStrictEqual([]);
    });

    it('keeps Cancel and Escape from closing the dialog while the deletes run', async () => {
      const repo = pluginRepository('file', { name: REPO_NAME });
      serve([boundTo(repo, { base_path: 'slow' })]);
      const release = holdTasks();
      const { onClose, user } = renderDialog({ repo });
      await screen.findByText('slow');

      await user.click(deleteButton());

      await waitFor(() => expect(deleteButton()).toBeDisabled());
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
      expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
      await user.keyboard('{Escape}');
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onClose).not.toHaveBeenCalled();
      await release();
    });

    it('stays open after a refused distribution, keeps the repository and says what was removed, what failed with the reason and that the repository was kept', async () => {
      const repo = pluginRepository('file', { name: REPO_NAME });
      const first = boundTo(repo, {
        base_path: 'a-removed',
        name: 'a-removed',
      });
      const refused = boundTo(repo, {
        base_path: 'b-refused',
        name: 'b-refused',
      });
      const sent = serve([first, refused], [], { refused: [refused] });
      const { onClose, onDeleted, user } = renderDialog({ repo });
      await screen.findByText('b-refused');

      await user.click(deleteButton());

      await screen.findByText(
        'The repository was kept because not every distribution was removed.',
      );
      expect(screen.getByText('a-removed')).toBeInTheDocument();
      expect(
        screen.getByText(
          /^b-refused: You do not have permission to do this\. You do not have permission to perform this action\./,
        ),
      ).toBeInTheDocument();
      expect(deleteButton()).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
      expect(onDeleted).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(sent.deletes).not.toContain(repo.pulp_href);

      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('says the repository was not removed, and never that distributions were removed, when no distribution serves it and Pulp refuses the delete', async () => {
      serve([], [], { repositoryRefused: true });
      const { user } = renderDialog();
      await screen.findByText(/No distribution serves this repository/);

      await user.click(deleteButton());

      expect(
        await screen.findByText('The repository was not removed.'),
      ).toBeVisible();
      expect(screen.queryByText(/The distributions were removed/)).toBeNull();
      expect(
        screen.getByText(
          /^The repository could not be removed: You do not have permission to do this\. The repository is in use\./,
        ),
      ).toBeVisible();
    });

    it('says the removal is not confirmed when the status of the repository task cannot be read', async () => {
      const repo = pluginRepository('file', { name: REPO_NAME });
      serve([]);
      server.use(
        http.get(`*${API}/tasks/${idOf(repo.pulp_href)}/`, () =>
          HttpResponse.json({ detail: 'bad gateway' }, { status: 502 }),
        ),
      );
      const { user } = renderDialog({ repo });
      await screen.findByText(/No distribution serves this repository/);

      await user.click(deleteButton());

      expect(
        await screen.findByText(
          'The removal of the repository has not been confirmed.',
        ),
      ).toBeVisible();
      expect(
        screen.getByText(/The outcome of removing the repository is unknown/),
      ).toBeVisible();
      expect(screen.getByRole('link', { name: 'task' })).toHaveAttribute(
        'href',
        `/tasks/${idOf(repo.pulp_href)}/`,
      );
    });

    it('deletes only the distributions it showed, reports one created since and keeps the repository', async () => {
      const repo = pluginRepository('file', { name: REPO_NAME });
      const shown = boundTo(repo, { base_path: 'a-shown', name: 'a-shown' });
      const late = boundTo(repo, {
        base_path: 'b-created-later',
        name: 'b-created-later',
      });
      const rows = [shown];
      const sent = serve(rows);
      const { user } = renderDialog({ repo });
      await screen.findByText('a-shown');
      // the distribution appears after the dialog listed them
      server.use(
        listOf(DISTRIBUTIONS, [shown, late], {
          pageSize: 1000,
          projected: projectedBy,
        }).handler,
      );

      await user.click(deleteButton());

      await screen.findByText(/The repository was kept/);
      expect(
        screen.getByText('Not removed, not shown when this dialog opened'),
      ).toBeVisible();
      expect(screen.getByText('b-created-later')).toBeInTheDocument();
      expect(sent.deletes).toStrictEqual([shown.pulp_href]);
    });

    it('shows the reason, offers Retry and keeps Delete disabled when the distributions cannot be listed', async () => {
      server.use(
        http.get(`*${DISTRIBUTIONS}`, () =>
          HttpResponse.json({ detail: 'boom' }, { status: 500 }),
        ),
        listOf(PUBLICATIONS, [], { projected: projectedBy }).handler,
      );
      renderDialog();

      await screen.findByText(/could not be listed, so nothing can be deleted/);
      expect(screen.getByText(/^Error 500/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
      expect(deleteButton()).toBeDisabled();
    });

    it('says nothing was deleted when the distributions cannot be listed at confirmation', async () => {
      const repo = pluginRepository('file', { name: REPO_NAME });
      const only = boundTo(repo, { base_path: 'only', name: 'only' });
      const sent = serve([only]);
      const { user } = renderDialog({ repo });
      await screen.findByText('only');
      server.use(
        http.get(`*${DISTRIBUTIONS}`, () =>
          HttpResponse.json({ detail: 'boom' }, { status: 500 }),
        ),
      );

      await user.click(deleteButton());

      await screen.findByText(/so nothing was deleted/);
      expect(screen.getByText(/^Error 500/)).toBeInTheDocument();
      expect(sent.deletes).toStrictEqual([]);
      // what was listed is shown again and the delete can be tried again
      expect(screen.getByText('only')).toBeVisible();
      expect(deleteButton()).toBeEnabled();
    });

    it('queues the result for the next screen, and calls nothing of this one, when the page is left while the delete runs', async () => {
      const repo = pluginRepository('file', { name: REPO_NAME });
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const sent = serve([boundTo(repo, { base_path: 'only', name: 'only' })]);
      server.use(
        http.get(`*${API}/tasks/:id/`, async ({ params }) => {
          await gate;
          return HttpResponse.json({
            pulp_href: `${API}/tasks/${params.id}/`,
            name: 'delete',
            state: 'completed',
          });
        }),
      );
      const { onClose, onDeleted, user } = renderDialog({ repo });
      await screen.findByText('only');

      await user.click(deleteButton());
      await waitFor(() => expect(sent.deletes).toHaveLength(1));
      await user.click(
        screen.getByRole('button', {
          name: 'Leave the page',
          hidden: true,
        }),
      );
      expect(screen.queryByRole('dialog')).toBeNull();

      await act(async () => release());

      await waitFor(() =>
        expect(queued()).toStrictEqual([`Removed repository ${REPO_NAME}`]),
      );
      expect(onDeleted).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(sent.deletes).toContain(repo.pulp_href);
    });

    it('queues what became of a repository that was kept, naming each distribution, when the page was left', async () => {
      const repo = pluginRepository('file', { name: REPO_NAME });
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const refused = boundTo(repo, { base_path: 'b', name: 'b' });
      const sent = serve([refused], [], { refused: [refused] });
      server.use(
        http.delete(`*${DISTRIBUTIONS}:id/`, async () => {
          await gate;
          return HttpResponse.json({ detail: 'No.' }, { status: 403 });
        }),
      );
      const { onDeleted, user } = renderDialog({ repo });
      await screen.findByText('b');

      await user.click(deleteButton());
      await user.click(
        screen.getByRole('button', {
          name: 'Leave the page',
          hidden: true,
        }),
      );
      await act(async () => release());

      await waitFor(() =>
        expect(queued()).toStrictEqual([
          'The repository was kept because not every distribution was removed.',
        ]),
      );
      expect(onDeleted).not.toHaveBeenCalled();
      expect(sent.deletes).not.toContain(repo.pulp_href);
    });

    it('does not claim nothing was deleted when the delete fails with an error other than a failed listing, and reads the lists again', async () => {
      const repo = pluginRepository('file', { name: REPO_NAME });
      const sent = serve([boundTo(repo, { base_path: 'only', name: 'only' })]);
      const { user } = renderDialog({ repo });
      await screen.findByText('only');
      vi.mocked(deleteRepositoryWithDistributions).mockRejectedValueOnce(
        new Error('something exploded'),
      );

      await user.click(deleteButton());

      await screen.findByText(/may already have been removed/);
      expect(screen.getByText('something exploded')).toBeInTheDocument();
      expect(screen.queryByText(/so nothing was deleted/)).toBeNull();
      expect(sent.deletes).toStrictEqual([]);
    });
  },
);
