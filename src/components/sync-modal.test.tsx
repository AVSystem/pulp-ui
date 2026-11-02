import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { listOf, repository, task } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { SyncModal } from './sync-modal';

const mirrorSwitch = () =>
  screen.getByRole('checkbox', {
    name: /Content not present in remote|Sync will only add/,
  });
const syncButton = () => screen.getByRole('button', { name: /^Sync/ });

describe('sync dialog, mirror switch', () => {
  it('starts with mirror on and lets the user turn it off', async () => {
    const syncAction = vi.fn().mockResolvedValue(undefined);
    const { user } = renderWithProviders(
      <SyncModal
        closeAction={() => null}
        name='tools'
        syncAction={syncAction}
      />,
    );

    expect(mirrorSwitch()).toBeChecked();
    expect(mirrorSwitch()).toBeEnabled();
    await user.click(mirrorSwitch());
    await user.click(syncButton());

    await waitFor(() => expect(syncAction).toHaveBeenCalled());
    expect(syncAction).toHaveBeenCalledWith(
      expect.objectContaining({ mirror: false }),
    );
  });

  it('keeps mirror off and disabled with the reason when it is locked', async () => {
    const syncAction = vi.fn().mockResolvedValue(undefined);
    const { user } = renderWithProviders(
      <SyncModal
        closeAction={() => null}
        mirrorLockedReason='Mirroring cannot be combined with autopublish.'
        name='tools'
        syncAction={syncAction}
      />,
    );

    expect(mirrorSwitch()).not.toBeChecked();
    expect(mirrorSwitch()).toBeDisabled();
    expect(
      screen.getByText('Mirroring cannot be combined with autopublish.'),
    ).toBeInTheDocument();

    await user.click(mirrorSwitch());
    await user.click(syncButton());

    await waitFor(() => expect(syncAction).toHaveBeenCalled());
    expect(syncAction).toHaveBeenCalledWith(
      expect.objectContaining({ mirror: false }),
    );
  });

  it('shows no reason line when mirroring is allowed', () => {
    renderWithProviders(
      <SyncModal closeAction={() => null} name='tools' syncAction={vi.fn()} />,
    );

    expect(screen.queryByText(/cannot be combined/)).toBeNull();
  });
});

const TASKS = '/pulp/api/v3/tasks/';

const SYNC_TASKS = {
  deb: 'pulp_deb.app.tasks.synchronizing.synchronize',
  file: 'pulp_file.app.tasks.synchronizing.synchronize',
};

describe('sync dialog, sync already queued or running', () => {
  it('says a sync is already running, links the task and disables Sync', async () => {
    const repo = repository();
    const running = task({ state: 'running', name: SYNC_TASKS.file });
    const { queries, handler } = listOf(TASKS, [running]);
    server.use(handler);

    renderWithProviders(
      <SyncModal
        closeAction={() => null}
        name='tools'
        plugin='file'
        repositoryHref={repo.pulp_href}
        syncAction={vi.fn()}
      />,
    );

    expect(
      await screen.findByText('A sync of this repository is already running.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View the task/ })).toHaveAttribute(
      'href',
      `/tasks/detail/${running.pulp_href.split('/').filter(Boolean).pop()}/`,
    );
    expect(syncButton()).toBeDisabled();
    expect(queries).toHaveLength(1);
    expect(queries[0].get('exclusive_resources')).toBe(repo.pulp_href);
    expect(queries[0].get('state__in')).toBe('waiting,running');
  });

  it('says a sync is queued when the task is still waiting', async () => {
    server.use(
      listOf(TASKS, [task({ state: 'waiting', name: SYNC_TASKS.file })])
        .handler,
    );

    renderWithProviders(
      <SyncModal
        closeAction={() => null}
        name='tools'
        plugin='file'
        repositoryHref={repository().pulp_href}
        syncAction={vi.fn()}
      />,
    );

    expect(
      await screen.findByText('A sync of this repository is already queued.'),
    ).toBeInTheDocument();
    expect(syncButton()).toBeDisabled();
  });

  it('names a waiting task of another name and disables Sync', async () => {
    server.use(
      listOf(TASKS, [
        task({
          state: 'waiting',
          name: 'pulp_file.app.tasks.publishing.publish',
        }),
      ]).handler,
    );

    renderWithProviders(
      <SyncModal
        closeAction={() => null}
        name='tools'
        plugin='file'
        repositoryHref={repository().pulp_href}
        syncAction={vi.fn()}
      />,
    );

    expect(
      await screen.findByText(
        /Another task is already queued for this repository: pulp_file\.app\.tasks\.publishing\.publish/,
      ),
    ).toBeInTheDocument();
    expect(syncButton()).toBeDisabled();
  });

  it('keeps Sync enabled and shows no warning when no task holds the repository', async () => {
    const { queries, handler } = listOf(TASKS, []);
    server.use(handler);

    renderWithProviders(
      <SyncModal
        closeAction={() => null}
        name='tools'
        plugin='file'
        repositoryHref={repository().pulp_href}
        syncAction={vi.fn()}
      />,
    );

    await waitFor(() => expect(queries).toHaveLength(1));
    expect(screen.queryByText(/already/)).toBeNull();
    expect(screen.queryByText(/Could not check/)).toBeNull();
    expect(syncButton()).toBeEnabled();
  });

  it('says the check failed and keeps Sync enabled when the task list cannot be read', async () => {
    server.use(
      http.get(`*${TASKS}`, () =>
        HttpResponse.json({ detail: 'broken' }, { status: 500 }),
      ),
    );

    renderWithProviders(
      <SyncModal
        closeAction={() => null}
        name='tools'
        plugin='file'
        repositoryHref={repository().pulp_href}
        syncAction={vi.fn()}
      />,
    );

    expect(
      await screen.findByText(
        /Could not check whether a sync is already running/,
      ),
    ).toBeInTheDocument();
    expect(syncButton()).toBeEnabled();
  });

  it('asks nothing of the task list without a repository', async () => {
    const { queries, handler } = listOf(TASKS, []);
    server.use(handler);

    renderWithProviders(
      <SyncModal closeAction={() => null} name='tools' syncAction={vi.fn()} />,
    );

    expect(syncButton()).toBeEnabled();
    expect(queries).toHaveLength(0);
  });

  it('detects a running sync of a deb repository', async () => {
    server.use(
      listOf(TASKS, [task({ state: 'running', name: SYNC_TASKS.deb })]).handler,
    );

    renderWithProviders(
      <SyncModal
        closeAction={() => null}
        name='tools'
        plugin='deb'
        repositoryHref={repository().pulp_href}
        syncAction={vi.fn()}
      />,
    );

    expect(
      await screen.findByText('A sync of this repository is already running.'),
    ).toBeInTheDocument();
    expect(syncButton()).toBeDisabled();
  });
});
