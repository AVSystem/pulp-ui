import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import { servePublishLab } from 'src/test-utils/publish-lab';
import {
  distributionListHandler,
  listOf,
  pluginDistribution,
  pluginListHandler,
  pluginPublication,
  pluginRepository,
  publicationListHandler,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import type { ServedState } from '../serving/served-state';
import { ServingFix } from './serving-fix';

const API = '/pulp/api/v3';
const ADD = 'file.add_filepublication';
const CHANGE = 'file.change_filedistribution';

let permissions: { stop: () => void };

beforeEach(() => {
  permissions = servePermissions({ id: 7, isStaff: true });
});

afterEach(() => {
  permissions.stop();
});

const tools = pluginRepository('file', { name: 'tools' });
const versionHref = (number: number) => `${tools.pulp_href}versions/${number}/`;

const dist = pluginDistribution('file', {
  name: 'tools-dist',
  repository: tools.pulp_href,
});

const state = (
  fix: ServedState['fix'],
  extra: Partial<ServedState> = {},
): ServedState => ({ state: 'no-publication', fix, ...extra });

function renderFix(
  served: ServedState,
  {
    distribution = dist,
    repositoryHref = tools.pulp_href as string | null,
  }: {
    distribution?: typeof dist;
    repositoryHref?: string | null;
  } = {},
) {
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <ServingFix
          plugin='file'
          distribution={distribution}
          served={served}
          repositoryHref={repositoryHref}
        />
      </PermissionsKnown>
    </AppContextProvider>,
  );
}

// What the server answers for the repository, its publications and the
// distribution, and every request that changes something.
function serveLab(publications: ReturnType<typeof pluginPublication>[] = []) {
  const lab = servePublishLab({ repository: tools });
  const patches: { path: string; body: unknown }[] = [];
  server.use(
    pluginListHandler('file', 'repository', [tools]).handler,
    publicationListHandler('file', publications).handler,
    distributionListHandler('file', [dist]).handler,
    http.patch(`*${API}/distributions/file/file/:id/`, async ({ request }) => {
      patches.push({
        path: new URL(request.url).pathname,
        body: await request.json(),
      });
      return HttpResponse.json({}, { status: 200 });
    }),
    listOf(`${API}/roles/`, [], { pageSize: 1000 }).handler,
  );
  return { lab, patches };
}

describe(
  'Integration: the fix beside a warning',
  { tags: ['integration'] },
  () => {
    describe('publish the latest version', () => {
      it('opens the publish dialog for the repository and says which distribution it repairs', async () => {
        const { lab } = serveLab();
        const { user } = renderFix(state('publish-latest'));

        await user.click(
          await screen.findByRole('button', { name: 'Publish latest version' }),
        );

        const dialog = await screen.findByRole('dialog');
        expect(
          await within(dialog).findByText('Publish repository "tools"'),
        ).toBeVisible();
        expect(within(dialog).getByText(/tools-dist/)).toBeVisible();
        await user.click(
          await within(dialog).findByRole('button', { name: 'Publish' }),
        );
        await waitFor(() => expect(lab.publishes).toHaveLength(1));
        expect(lab.publishes[0]).toEqual({ repository: tools.pulp_href });
      });

      it('is offered only to a user who may add publications', async () => {
        permissions.stop();
        permissions = servePermissions({
          id: 7,
          isStaff: false,
          own: [[CHANGE]],
        });
        serveLab();

        renderFix(state('publish-latest'));

        await waitFor(() =>
          expect(screen.queryByText('Cannot be checked')).toBeNull(),
        );
        expect(
          screen.queryByRole('button', { name: 'Publish latest version' }),
        ).toBeNull();
      });
    });

    describe('publish the bound version', () => {
      it('opens the publish dialog for that version', async () => {
        const { lab } = serveLab();
        const bound = pluginDistribution('file', {
          name: 'pinned',
          repository_version: versionHref(2),
        });
        const { user } = renderFix(state('publish-version'), {
          distribution: bound,
        });

        await user.click(
          await screen.findByRole('button', { name: 'Publish version 2' }),
        );

        const dialog = await screen.findByRole('dialog');
        expect(
          await within(dialog).findByText('Publish version 2 of "tools"'),
        ).toBeVisible();
        await user.click(
          await within(dialog).findByRole('button', { name: 'Publish' }),
        );
        await waitFor(() => expect(lab.publishes).toHaveLength(1));
        expect(lab.publishes[0]).toEqual({
          repository_version: versionHref(2),
        });
      });
    });

    describe('serve the newest publication', () => {
      const older = pluginPublication('file', {
        repository: tools.pulp_href,
        repository_version: versionHref(1),
        pulp_created: '2024-01-02T00:00:00.000000Z',
      });
      const newest = pluginPublication('file', {
        repository: tools.pulp_href,
        repository_version: versionHref(3),
        pulp_created: '2024-01-04T00:00:00.000000Z',
      });
      const stale = state('serve-newest', {
        state: 'stale',
        servedVersion: 1,
        latestVersion: 3,
      });
      const pinned = pluginDistribution('file', {
        name: 'tools-dist',
        publication: older.pulp_href,
      });

      it('asks, then sends one change with the new binding and the other bindings null', async () => {
        const { patches } = serveLab([older, newest]);
        const { user } = renderFix(stale, { distribution: pinned });

        await user.click(
          await screen.findByRole('button', {
            name: 'Serve the newest publication',
          }),
        );

        const dialog = await screen.findByRole('dialog');
        expect(
          await within(dialog).findByText(
            'Serve the newest publication (version 3) from tools-dist?',
          ),
        ).toBeVisible();
        expect(patches).toEqual([]);
        await user.click(
          await within(dialog).findByRole('button', { name: 'Serve it' }),
        );

        await waitFor(() => expect(patches).toHaveLength(1));
        expect(patches[0]).toEqual({
          path: pinned.pulp_href,
          body: {
            publication: newest.pulp_href,
            repository: null,
            repository_version: null,
          },
        });
        expect(await within(dialog).findByText(/now serves/)).toBeVisible();
      });

      it('sends nothing when the user cancels', async () => {
        const { patches } = serveLab([older, newest]);
        const { user } = renderFix(stale, { distribution: pinned });

        await user.click(
          await screen.findByRole('button', {
            name: 'Serve the newest publication',
          }),
        );
        const dialog = await screen.findByRole('dialog');
        await within(dialog).findByText(
          /Serve the newest publication \(version/,
        );
        await user.click(
          within(dialog).getByRole('button', { name: 'Cancel' }),
        );

        await waitFor(() =>
          expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
        );
        expect(patches).toEqual([]);
      });

      it('shows the refusal of the server and keeps the dialog', async () => {
        serveLab([older, newest]);
        server.use(
          http.patch(`*${API}/distributions/file/file/:id/`, () =>
            HttpResponse.json({ detail: 'Not allowed here.' }, { status: 403 }),
          ),
        );
        const { user } = renderFix(stale, { distribution: pinned });

        await user.click(
          await screen.findByRole('button', {
            name: 'Serve the newest publication',
          }),
        );
        const dialog = await screen.findByRole('dialog');
        await user.click(
          await within(dialog).findByRole('button', { name: 'Serve it' }),
        );

        expect(
          await within(dialog).findByText('Not allowed here.'),
        ).toBeVisible();
      });

      it('is offered only to a user who may change the distribution', async () => {
        permissions.stop();
        permissions = servePermissions({ id: 7, isStaff: false, own: [[ADD]] });
        serveLab([older, newest]);

        renderFix(stale, { distribution: pinned });

        await waitFor(() => expect(screen.queryByRole('button')).toBeNull());
        expect(
          screen.queryByRole('button', {
            name: 'Serve the newest publication',
          }),
        ).toBeNull();
      });
    });

    describe('a distribution bound to nothing', () => {
      it('links to the edit page of the distribution', async () => {
        serveLab();

        renderFix(state('edit', { state: 'unbound' }));

        expect(
          await screen.findByRole('link', { name: 'Choose what it serves' }),
        ).toHaveAttribute('href', '/file/distributions/tools-dist/edit');
      });

      it('offers no link to a user who may not change the distribution', async () => {
        permissions.stop();
        permissions = servePermissions({ id: 7, isStaff: false, own: [[ADD]] });
        serveLab();

        renderFix(state('edit', { state: 'unbound' }));

        await waitFor(() => expect(screen.queryByRole('link')).toBeNull());
      });
    });

    describe('no fix', () => {
      it('draws nothing for a state that has none, a row that cannot be checked included', async () => {
        serveLab();

        const { container } = renderFix({
          state: 'cannot-check',
          reason: 'no-permission',
          fix: null,
        });

        await waitFor(() =>
          expect(container.querySelector('button')).toBeNull(),
        );
        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.queryByRole('link')).toBeNull();
      });

      it('draws nothing when the repository is not known and a fix needs it', async () => {
        serveLab();

        renderFix(state('publish-latest'), { repositoryHref: null });

        await waitFor(() => expect(screen.queryByRole('button')).toBeNull());
      });
    });
  },
);
