import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { generatedVersions } from 'src/entities/core/status/generated-versions';
import { serveUserRecords } from 'src/test-utils/permissions';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { PulpAboutModal } from './pulp-about-modal';

function signIn(isStaff = true) {
  serveUserRecords({ id: 1, isStaff });
  server.use(
    http.get('*/pulp/api/v3/login/', () =>
      HttpResponse.json({
        username: 'zoe',
        pulp_href: '/pulp/api/v3/users/1/',
      }),
    ),
  );
}

function renderModal() {
  return renderWithProviders(
    <AppContextProvider>
      <PulpAboutModal isOpen onClose={() => undefined} username='zoe' />
    </AppContextProvider>,
  );
}

// Answers status/ with the plugin versions the interface was generated for,
// changed by the given entries; an entry of null leaves the plugin out.
function reportVersions(changes: Record<string, string | null> = {}) {
  const running = { ...generatedVersions, ...changes };
  server.use(
    http.get('*/pulp/api/v3/status/', () =>
      HttpResponse.json({
        versions: Object.entries(running)
          .filter(([, version]) => version !== null)
          .map(([component, version]) => ({ component, version })),
      }),
    ),
  );
}

describe('about dialog', () => {
  it('shows the core version the server reports', async () => {
    signIn();
    server.use(
      http.get('*/pulp/api/v3/status/', () =>
        HttpResponse.json({
          versions: [{ component: 'core', version: '3.77.1' }],
        }),
      ),
    );

    renderModal();

    expect(await screen.findByRole('link', { name: '3.77.1' })).toBeVisible();
  });

  it('does not fail when the server does not report the core component', async () => {
    signIn();
    server.use(
      http.get('*/pulp/api/v3/status/', () =>
        HttpResponse.json({
          versions: [{ component: 'file', version: '3.0.0' }],
        }),
      ),
    );

    renderModal();

    expect(await screen.findByText('Pulp core version')).toBeVisible();
  });
});

describe('about dialog account', () => {
  it('shows the username of the account as plain text, with no group list', async () => {
    signIn();
    reportVersions();

    renderModal();

    await screen.findByRole('link', { name: generatedVersions.core });
    expect(screen.getByText('zoe')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'zoe' })).toBeNull();
    expect(screen.queryByText('User groups')).toBeNull();
  });
});

describe('about dialog version note', () => {
  const generatedFor = generatedVersions.rpm;
  const different = 'zz-other';

  it('tells an administrator where the server runs other versions than the interface was generated for', async () => {
    signIn(true);
    reportVersions({ rpm: different, ansible: null, hugging_face: '0.1.0' });

    renderModal();

    expect(
      await screen.findByText(
        `rpm: the interface was generated for ${generatedFor}, this server runs ${different}`,
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        'ansible: generated in the interface, not installed on this server',
      ),
    ).toBeVisible();
    expect(
      screen.getByText('hugging_face: not part of the generated interface'),
    ).toBeVisible();
    expect(screen.queryByText(/^core:/)).toBeNull();
  });

  it('shows nothing to an administrator whose server runs the generated versions', async () => {
    signIn(true);
    reportVersions();

    renderModal();

    await screen.findByRole('link', { name: generatedVersions.core });
    expect(screen.queryByText(/the interface was generated for/)).toBeNull();
    expect(
      screen.queryByText(/not part of the generated interface/),
    ).toBeNull();
    expect(screen.queryByText(/not installed on this server/)).toBeNull();
  });

  it('shows nothing to an account that is not an administrator', async () => {
    signIn(false);
    reportVersions({ rpm: different });

    renderModal();

    await screen.findByRole('link', { name: generatedVersions.core });
    expect(screen.queryByText(/the interface was generated for/)).toBeNull();
  });

  it('shows nothing while the permissions are not known', async () => {
    serveUserRecords({ id: 1, isStaff: true });
    server.use(
      http.get('*/pulp/api/v3/login/', () =>
        HttpResponse.json({
          username: 'zoe',
          pulp_href: '/pulp/api/v3/users/1/',
        }),
      ),
      // The record of the account never arrives, so the permissions stay unknown.
      http.get('*/pulp/api/v3/users/1/', () => new Promise(() => undefined)),
    );
    reportVersions({ rpm: different });

    renderModal();

    await screen.findByRole('link', { name: generatedVersions.core });
    expect(screen.queryByText(/the interface was generated for/)).toBeNull();
  });
});
