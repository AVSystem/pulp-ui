import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import { resetSessionEvents } from 'src/session/session-events';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import {
  distributionListHandler,
  pluginListHandler,
  pluginRepository,
  publicationListHandler,
  repositoryVersion,
  versionListHandler,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { PLUGIN_MANIFESTS, type PluginManifest } from '../manifest';
import { frameworkRoutes } from '../routes';

const API = '/pulp/api/v3';
const TASK_ID = '00000000-0000-4000-8000-0000000000aa';
const TASK_HREF = `${API}/tasks/${TASK_ID}/`;

const FILE: PluginManifest = {
  ...(PLUGIN_MANIFESTS.find(
    ({ plugin }) => plugin === 'file',
  ) as PluginManifest),
  onFramework: true,
};

function Routed() {
  const { pathname } = useLocation();

  return (
    <>
      <p data-testid='location'>{pathname}</p>
      {useRoutes(guardRoutes(frameworkRoutes([FILE])))}
    </>
  );
}

let permissions: { stop: () => void };

beforeEach(() => {
  permissions = servePermissions({ id: 7, isStaff: true });
});

afterEach(() => {
  permissions.stop();
  resetSessionEvents();
});

// The repository tools with versions 0 to 2, version 2 the latest, and every
// modify request it receives, with the body it carried.
function serveLab(
  answer: () => Response | Promise<Response> = () =>
    HttpResponse.json({ task: TASK_HREF }, { status: 202 }),
) {
  const base = pluginRepository('file', { name: 'tools' });
  const versions = [0, 1, 2].map((number) => repositoryVersion(base, number));
  const repository = { ...base, latest_version_href: versions[2].pulp_href };
  const modifies: { path: string; body: unknown }[] = [];

  server.use(
    pluginListHandler('file', 'repository', [repository]).handler,
    distributionListHandler('file', []).handler,
    publicationListHandler('file', []).handler,
    versionListHandler(repository, versions).handler,
    http.post(`*${repository.pulp_href}modify/`, async ({ request }) => {
      modifies.push({
        path: new URL(request.url).pathname,
        body: await request.json(),
      });
      return answer();
    }),
  );

  return { repository, versions, modifies };
}

function renderTab() {
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <Routed />
      </PermissionsKnown>
    </AppContextProvider>,
    { route: '/file/repositories/tools/versions', signedIn: true },
  );
}

async function openRevert(user: ReturnType<typeof renderTab>['user'], n = '1') {
  const link = await screen.findByRole('link', { name: n });
  const row = link.closest('tr') as HTMLElement;
  await user.click(await within(row).findByRole('button', { name: 'Actions' }));
  await user.click(
    await screen.findByRole('menuitem', { name: /Revert to this version/ }),
  );
}

const dialog = () => screen.findByRole('dialog');
const confirm = async () =>
  within(await dialog()).getByRole('button', { name: /^Revert/ });

describe(
  'Integration: reverting a repository to an earlier version',
  { tags: ['integration'] },
  () => {
    it('asks for confirmation naming the repository and the version before anything is sent, and Cancel sends nothing', async () => {
      const { modifies } = serveLab();
      const { user } = renderTab();

      await openRevert(user, '1');

      const shown = await dialog();
      expect(shown.textContent).toContain(
        'Revert repository "tools" to version 1?',
      );
      expect(modifies).toEqual([]);

      await user.click(within(shown).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(modifies).toEqual([]);
    });

    it('sends one modify request with the version as the base, closes the dialog once it is accepted and names the started task with its link', async () => {
      const { modifies, versions } = serveLab();
      const { user } = renderTab();

      await openRevert(user, '1');
      await user.click(await confirm());

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(modifies).toHaveLength(1);
      expect(modifies[0].path).toMatch(
        /\/repositories\/file\/file\/[^/]+\/modify\/$/,
      );
      expect(modifies[0].body).toEqual({ base_version: versions[1].pulp_href });

      expect(
        await screen.findByText('Revert started for repository "tools".'),
      ).toBeVisible();
      const link = screen.getByRole('link', { name: /detail page/ });
      expect(link.getAttribute('href')).toContain(TASK_ID);
    });

    it('sends one request however often Confirm is pressed while the request is pending', async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { modifies } = serveLab(async () => {
        await gate;
        return HttpResponse.json({ task: TASK_HREF }, { status: 202 });
      });
      const { user } = renderTab();

      await openRevert(user, '1');
      const button = await confirm();
      await user.click(button);
      await user.click(button);
      await user.click(button);

      await waitFor(() => expect(modifies).toHaveLength(1));
      expect(button).toBeDisabled();
      expect(screen.getByRole('dialog')).toBeVisible();

      release();
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(modifies).toHaveLength(1);
    });

    it('shows the three-part refusal and closes the dialog when the request is refused', async () => {
      const { modifies } = serveLab(() =>
        HttpResponse.json({ detail: 'Not for you.' }, { status: 403 }),
      );
      const { user } = renderTab();

      await openRevert(user, '1');
      await user.click(await confirm());

      expect(
        await screen.findByText(
          'Failed to revert repository "tools" to version "1"',
        ),
      ).toBeVisible();
      expect(
        screen.getByText('You do not have permission to do this.'),
      ).toBeVisible();
      expect(screen.getByText('Not for you.')).toBeVisible();
      expect(
        screen.getByText(
          'Contact your organization administrator for more information.',
        ),
      ).toBeVisible();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryByText(/Revert started/)).toBeNull();
      expect(modifies).toHaveLength(1);
    });

    it('reports another failure with its reason and closes the dialog', async () => {
      serveLab(() =>
        HttpResponse.json(
          { base_version: ['Invalid version.'] },
          { status: 400 },
        ),
      );
      const { user } = renderTab();

      await openRevert(user, '0');
      await user.click(await confirm());

      expect(
        await screen.findByText(
          'Failed to revert repository "tools" to version "0"',
        ),
      ).toBeVisible();
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('keeps the dialog open and adds no alert when the session ends', async () => {
      let answers = 0;
      const { modifies } = serveLab(() => {
        answers += 1;
        return answers === 1
          ? HttpResponse.json({ detail: 'Sign in.' }, { status: 401 })
          : HttpResponse.json({ task: TASK_HREF }, { status: 202 });
      });
      const { user } = renderTab();

      await openRevert(user, '1');
      await user.click(await confirm());

      await waitFor(() => expect(modifies).toHaveLength(1));
      await waitFor(async () => expect(await confirm()).toBeEnabled());
      expect(screen.getByRole('dialog')).toBeVisible();
      expect(screen.queryByText(/Failed to revert/)).toBeNull();
      expect(modifies).toHaveLength(1);
    });
  },
);
