import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import {
  type IContentGuard,
  type IDistribution,
  contentGuard,
  distribution,
  listOf,
  repository,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { type DeleteRepositoryResult } from '../utilities/delete-repository';
import { DeleteRepositoryModal } from './delete-repository-modal';

const API = '/pulp/api/v3';
const REPO_NAME = 'zz-test-repo';

const kept = (
  overrides: Partial<DeleteRepositoryResult> = {},
): DeleteRepositoryResult => ({
  removed: [],
  failed: [],
  pending: [],
  unknown: [],
  repositoryDeleted: false,
  repositoryError: null,
  repositoryPending: null,
  repositoryUnknown: null,
  ...overrides,
});

// Serves the file plugin with the given distributions (all bound to the
// repository) and the guards, and records the guard requests.
function serve(distributions: IDistribution[], guards: IContentGuard[] = []) {
  const guardQueries: URLSearchParams[] = [];
  server.use(
    listOf(`${API}/distributions/file/file/`, distributions, {
      pageSize: 1000,
      matching: (row, query) =>
        query.has('repository')
          ? row.repository === query.get('repository')
          : true,
    }).handler,
    listOf(`${API}/publications/file/file/`, []).handler,
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
  return { guardQueries };
}

function renderModal({
  deleteAction = vi.fn().mockResolvedValue(kept({ repositoryDeleted: true })),
  repo = repository({ name: REPO_NAME }),
} = {}) {
  const closeAction = vi.fn();
  const view = renderWithProviders(
    <DeleteRepositoryModal
      closeAction={closeAction}
      deleteAction={deleteAction}
      name={repo.name}
      plugin='file'
      pulpHref={repo.pulp_href}
    />,
  );
  return { closeAction, deleteAction, repo, ...view };
}

const deleteButton = () => screen.getByRole('button', { name: /^Delete/ });
const nameInput = () => screen.getByLabelText(/Type the repository name/);

// the distributions are bound to the repository of the modal
function boundTo(
  repo: { pulp_href: string },
  overrides: Partial<IDistribution>,
) {
  return distribution({ repository: repo.pulp_href, ...overrides });
}

describe('the delete repository dialog', () => {
  it('lists every distribution sorted by name with the URL the server reports', async () => {
    const repo = repository({ name: REPO_NAME });
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

    renderModal({ repo });

    await screen.findByText('https://pulp.example/content/served-first/');
    const text = document.body.textContent;
    expect(text).toContain('https://pulp.example/content/served-second/');
    expect(text.indexOf('aa-first')).toBeLessThan(text.indexOf('zz-second'));
  });

  it('says a distribution with nothing to serve is not served', async () => {
    const repo = repository({ name: REPO_NAME });
    // the repository has no publication, so the content app answers 404
    serve([boundTo(repo, { base_path: 'unpublished' })]);

    renderModal({ repo });

    await screen.findByText('unpublished');
    expect(screen.getByText(/Not served/)).toBeInTheDocument();
  });

  it('marks a distribution protected by a content guard as customer-facing and names the guard', async () => {
    const repo = repository({ name: REPO_NAME });
    const guard = contentGuard({ name: 'customers-only' });
    const open = boundTo(repo, { base_path: 'open' });
    const guarded = boundTo(repo, {
      base_path: 'guarded',
      content_guard: guard.pulp_href,
    });
    const { guardQueries } = serve([open, guarded], [guard]);

    renderModal({ repo });

    await screen.findByText(/Guard: customers-only/);
    expect(screen.getAllByText(/Protected by a content guard/)).toHaveLength(1);
    expect(guardQueries).toHaveLength(1);
    expect(guardQueries[0].get('pulp_href__in')).toBe(guard.pulp_href);
  });

  it('marks the distribution as guarded without a name when the guards cannot be read', async () => {
    const repo = repository({ name: REPO_NAME });
    const guarded = boundTo(repo, {
      base_path: 'guarded',
      content_guard: contentGuard().pulp_href,
    });
    serve([guarded]);
    server.use(
      http.get(`*${API}/contentguards/`, () =>
        HttpResponse.json({ detail: 'nope' }, { status: 403 }),
      ),
    );

    renderModal({ repo });

    await screen.findByText(/Protected by a content guard/);
    expect(screen.getByText('guarded')).toBeInTheDocument();
    expect(screen.queryByText(/Guard:/)).not.toBeInTheDocument();
  });

  it('says no distribution serves a repository without one', async () => {
    serve([]);

    renderModal();

    await screen.findByText(/No distribution serves this repository/);
  });

  it('keeps Delete disabled until the typed text equals the repository name exactly', async () => {
    serve([]);
    const { deleteAction, user } = renderModal();
    await screen.findByText(/No distribution serves this repository/);

    expect(deleteButton()).toBeDisabled();

    await user.type(nameInput(), REPO_NAME.toUpperCase());
    expect(deleteButton()).toBeDisabled();

    await user.clear(nameInput());
    await user.type(nameInput(), `${REPO_NAME} `);
    expect(deleteButton()).toBeDisabled();

    await user.clear(nameInput());
    await user.type(nameInput(), REPO_NAME);
    expect(deleteButton()).toBeEnabled();

    await user.click(deleteButton());
    expect(deleteAction).toHaveBeenCalledTimes(1);
  });

  it('shows the spinner and disables Delete while the deletes run', async () => {
    serve([]);
    let finish: (result: DeleteRepositoryResult) => void;
    const deleteAction = vi.fn(
      () =>
        new Promise<DeleteRepositoryResult>((resolve) => {
          finish = resolve;
        }),
    );
    const { user } = renderModal({ deleteAction });
    await screen.findByText(/No distribution serves this repository/);

    await user.type(nameInput(), REPO_NAME);
    await user.click(deleteButton());

    await waitFor(() => expect(deleteButton()).toBeDisabled());
    expect(
      deleteButton().querySelector('.pf-v5-c-spinner'),
    ).toBeInTheDocument();

    finish(kept({ repositoryDeleted: true }));
  });

  it('stays open after a partial failure and says what was removed, what failed with the reason, what is still being removed and that the repository was kept', async () => {
    serve([]);
    const taskHref = `${API}/tasks/00000000-0000-4000-8000-0000000000aa/`;
    const deleteAction = vi.fn().mockResolvedValue(
      kept({
        removed: ['removed-one'],
        failed: [
          {
            name: 'refused-one',
            reason: 'You do not have permission to perform this action.',
          },
        ],
        pending: [{ name: 'slow-one', taskHref }],
      }),
    );
    const { closeAction, user } = renderModal({ deleteAction });
    await screen.findByText(/No distribution serves this repository/);

    await user.type(nameInput(), REPO_NAME);
    await user.click(deleteButton());

    await screen.findByText(/The repository was kept/);
    expect(screen.getByText('removed-one')).toBeInTheDocument();
    expect(
      screen.getByText(
        'refused-one: You do not have permission to perform this action.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/slow-one/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'task' })).toHaveAttribute(
      'href',
      '/tasks/detail/00000000-0000-4000-8000-0000000000aa/',
    );
    expect(deleteButton()).toBeDisabled();
    expect(closeAction).not.toHaveBeenCalled();
  });

  it('says the outcome is unknown, with the task link, for a delete whose task status could not be read', async () => {
    serve([]);
    const taskHref = `${API}/tasks/00000000-0000-4000-8000-0000000000cc/`;
    const deleteAction = vi
      .fn()
      .mockResolvedValue(
        kept({ unknown: [{ name: 'unreadable-one', taskHref }] }),
      );
    const { user } = renderModal({ deleteAction });
    await screen.findByText(/No distribution serves this repository/);

    await user.type(nameInput(), REPO_NAME);
    await user.click(deleteButton());

    await screen.findByText(/The repository was kept/);
    expect(screen.getByText('Outcome unknown, check the task')).toBeVisible();
    expect(screen.getByText(/unreadable-one/)).toBeInTheDocument();
    expect(screen.queryByText('Not removed')).toBeNull();
    expect(screen.getByRole('link', { name: 'task' })).toHaveAttribute(
      'href',
      '/tasks/detail/00000000-0000-4000-8000-0000000000cc/',
    );
  });

  it('shows the reason and keeps Delete disabled when the distributions cannot be listed', async () => {
    server.use(
      http.get(`*${API}/distributions/file/file/`, () =>
        HttpResponse.json({ detail: 'boom' }, { status: 500 }),
      ),
      listOf(`${API}/publications/file/file/`, []).handler,
    );
    const { user } = renderModal();

    await screen.findByText(/could not be listed, so nothing can be deleted/);
    expect(screen.getByText(/^Error 500/)).toBeInTheDocument();

    await user.type(nameInput(), REPO_NAME);
    expect(deleteButton()).toBeDisabled();
  });

  it('says nothing was deleted when the distributions cannot be listed at confirmation', async () => {
    serve([]);
    const deleteAction = vi
      .fn()
      .mockRejectedValue({ response: { status: 500, statusText: 'Server' } });
    const { user } = renderModal({ deleteAction });
    await screen.findByText(/No distribution serves this repository/);

    await user.type(nameInput(), REPO_NAME);
    await user.click(deleteButton());

    await screen.findByText(/so nothing was deleted/);
  });
});
