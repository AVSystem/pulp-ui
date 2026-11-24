import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { RouterProvider, createMemoryRouter, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { dataRoutes } from 'src/app-routes';
import { resetSessionEvents } from 'src/session/session-events';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import { listOf, page, signingService } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import SignatureKeyList from './signature-key-list';

const SERVICES = '/pulp/api/v3/signing-services/';

const download = vi.hoisted(() => vi.fn());
vi.mock('src/utilities/download-data', () => ({
  downloadString: download,
}));

let permissions: { stop: () => void };

beforeEach(() => {
  permissions = servePermissions({ id: 7, isStaff: true });
});

afterEach(() => {
  permissions.stop();
  resetSessionEvents();
  server.events.removeAllListeners();
  download.mockReset();
});

function Go({ to }: { to: string }) {
  const navigate = useNavigate();

  return (
    <button type='button' onClick={() => navigate(to)}>
      {`go ${to}`}
    </button>
  );
}

function renderList(route = '/signature-keys') {
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <Go to='/signature-keys?name=zz-b' />
        <SignatureKeyList />
      </PermissionsKnown>
    </AppContextProvider>,
    { route },
  );
}

const rowOf = (name: string) =>
  screen.getByText(name).closest('tr') as HTMLElement;

describe(
  'Integration: the signature keys list',
  { tags: ['integration'] },
  () => {
    it('reads one page of fifty by name and shows the name, fingerprint and creation date of each service', async () => {
      const list = listOf(SERVICES, [
        signingService({
          name: 'zz-signer',
          pubkey_fingerprint: 'AB12CD34',
          pulp_created: '2024-03-05T10:00:00.000000Z',
        }),
      ]);
      server.use(list.handler);

      renderList();

      const row = (await screen.findByText('zz-signer')).closest(
        'tr',
      ) as HTMLElement;
      expect(within(row).getByText('AB12CD34')).toBeVisible();
      expect(within(row).getByText(/2024/)).toBeVisible();
      expect(list.queries).toHaveLength(1);
      const query = list.queries[0] as URLSearchParams;
      expect(query.get('offset')).toBe('0');
      expect(query.get('limit')).toBe('50');
      expect(query.get('ordering')).toBe('name');
      expect(query.has('name')).toBe(false);
    });

    it('shows the public key of a service in its row, ready to copy', async () => {
      server.use(
        listOf(SERVICES, [
          signingService({ name: 'zz-signer', public_key: 'zz public key' }),
        ]).handler,
      );

      renderList();
      await screen.findByText('zz-signer');

      expect(
        within(rowOf('zz-signer')).getByDisplayValue('zz public key'),
      ).toBeVisible();
      expect(
        within(rowOf('zz-signer')).getByRole('button', { name: /copy/i }),
      ).toBeVisible();
    });

    it('saves the public key of a row as a named .asc file', async () => {
      server.use(
        listOf(SERVICES, [
          signingService({ name: 'zz-signer', public_key: 'zz public key' }),
        ]).handler,
      );

      const { user } = renderList();
      await screen.findByText('zz-signer');
      await user.click(
        within(rowOf('zz-signer')).getByRole('button', {
          name: /actions|kebab/i,
        }),
      );
      await user.click(
        await screen.findByRole('menuitem', { name: 'Download key' }),
      );

      expect(download).toHaveBeenCalledTimes(1);
      expect(download).toHaveBeenCalledWith('zz public key', 'zz-signer.asc');
    });

    it('never shows the script of a service', async () => {
      server.use(
        listOf(SERVICES, [
          {
            ...signingService({ name: 'zz-signer' }),
            script: '/var/lib/pulp/scripts/zz-sign.sh',
          },
        ]).handler,
      );

      renderList();
      await screen.findByText('zz-signer');

      expect(document.body.textContent).not.toContain('zz-sign.sh');
    });

    it('asks the server for the name in the address and shows it as a filter', async () => {
      const list = listOf(SERVICES, [signingService({ name: 'zz-b' })]);
      server.use(list.handler);

      renderList('/signature-keys?name=zz-b&page_size=20');

      await screen.findByText('zz-b');

      const query = list.queries[0] as URLSearchParams;
      expect(query.get('name')).toBe('zz-b');
      expect(query.get('limit')).toBe('20');
      expect(screen.getAllByText('zz-b').length).toBeGreaterThan(1);
    });

    it('shows the way out of a filter that matches nothing and never says there are no keys', async () => {
      server.use(
        http.get(`*${SERVICES}`, ({ request }) =>
          new URL(request.url).searchParams.has('name')
            ? HttpResponse.json(page([]))
            : HttpResponse.json(page([signingService({ name: 'zz-a' })])),
        ),
      );

      renderList('/signature-keys?name=nothing');

      expect(await screen.findByText(/clear all filters/i)).toBeVisible();
      expect(screen.queryByText('No signature keys yet')).toBeNull();
    });

    it('shows no signature keys yet only when the server counts none', async () => {
      server.use(listOf(SERVICES, []).handler);

      renderList();

      expect(await screen.findByText('No signature keys yet')).toBeVisible();
    });

    it('shows the error with Retry when the read fails, never "no signature keys", and reads again on Retry', async () => {
      let answer = 500;
      server.use(
        http.get(`*${SERVICES}`, () =>
          answer === 500
            ? HttpResponse.json({ detail: 'boom' }, { status: 500 })
            : HttpResponse.json(page([])),
        ),
      );

      const { user } = renderList();

      expect(
        await screen.findByText('Signature keys could not be displayed.'),
      ).toBeVisible();
      expect(screen.queryByText('No signature keys yet')).toBeNull();

      answer = 200;
      await act(async () => {
        await user.click(screen.getByRole('button', { name: 'Retry' }));
      });

      expect(await screen.findByText('No signature keys yet')).toBeVisible();
    });

    it('shows the insufficient permissions page with the reason when the read is refused', async () => {
      server.use(
        http.get(`*${SERVICES}`, () =>
          HttpResponse.json(
            { detail: 'You do not have permission to perform this action.' },
            { status: 403 },
          ),
        ),
      );

      renderList();

      expect(
        await screen.findByText(
          'You do not have permission to perform this action.',
        ),
      ).toBeVisible();
      expect(screen.queryByText('No signature keys yet')).toBeNull();
      expect(
        screen.queryByText('Signature keys could not be displayed.'),
      ).toBeNull();
    });

    it('keeps the answer of the newer filter when a slower answer to an earlier one arrives after it', async () => {
      let releaseFirst: () => void = () => undefined;
      const firstHeld = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      server.use(
        http.get(`*${SERVICES}`, async ({ request }) => {
          if (new URL(request.url).searchParams.has('name')) {
            return HttpResponse.json(page([signingService({ name: 'zz-b' })]));
          }
          await firstHeld;

          return HttpResponse.json(page([signingService({ name: 'zz-a' })]));
        }),
      );

      const { user } = renderList();
      await user.click(
        await screen.findByRole('button', {
          name: 'go /signature-keys?name=zz-b',
        }),
      );
      await waitFor(() => {
        expect(screen.getAllByText('zz-b').length).toBeGreaterThan(0);
      });

      await act(async () => {
        releaseFirst();
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      expect(screen.queryByText('zz-a')).toBeNull();
      expect(screen.getAllByText('zz-b').length).toBeGreaterThan(0);
    });

    it('goes to the last page that has rows when the address is past the end', async () => {
      server.use(
        listOf(
          SERVICES,
          Array.from({ length: 12 }, (_, n) =>
            signingService({ name: `zz-${String(n).padStart(2, '0')}` }),
          ),
        ).handler,
      );

      renderList('/signature-keys?page=9&page_size=10');

      expect(await screen.findByText('zz-11')).toBeVisible();
      expect(screen.queryByText('No signature keys yet')).toBeNull();
    });
  },
);

describe(
  'Integration: opening the signature keys by address',
  { tags: ['integration'] },
  () => {
    it('asks who is signed in once for a viewer', async () => {
      permissions.stop();
      permissions = servePermissions({ isStaff: false });
      const sessionReads: string[] = [];
      server.events.on('request:start', ({ request }) => {
        if (
          request.method === 'GET' &&
          new URL(request.url).pathname.endsWith('/pulp/api/v3/login/')
        ) {
          sessionReads.push(request.url);
        }
      });

      const router = createMemoryRouter(dataRoutes, {
        initialEntries: ['/signature-keys'],
      });
      render(
        <I18nProvider i18n={i18n}>
          <RouterProvider router={router} />
        </I18nProvider>,
      );

      expect(
        (await screen.findAllByText('Insufficient permissions')).length,
      ).toBeGreaterThan(0);
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(sessionReads).toHaveLength(1);
    });
  },
);
