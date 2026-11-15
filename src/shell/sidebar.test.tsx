import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetPageWidth, setPageUrl, setPageWidth } from 'src/test-utils/page';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { Shell } from './shell';
import { SIDEBAR_STORAGE_KEY, initialSidebarOpen } from './sidebar';

function signIn() {
  server.use(
    http.get('*/pulp/api/v3/login/', () =>
      HttpResponse.json({
        username: 'zoe',
        pulp_href: '/pulp/api/v3/users/1/',
      }),
    ),
  );
}

function reportCore(version: string) {
  server.use(
    http.get('*/pulp/api/v3/status/', () =>
      HttpResponse.json({
        versions: [
          { component: 'core', version },
          { component: 'file', version: '1.2.3' },
        ],
      }),
    ),
  );
}

function renderShell() {
  return renderWithProviders(
    <Shell>
      <h1>Screen title</h1>
    </Shell>,
    { route: '/tasks' },
  );
}

const sidebar = () => document.getElementById('page-sidebar') as HTMLElement;
const isCollapsed = () => sidebar().getAttribute('aria-hidden') === 'true';

describe('sidebar footer', () => {
  beforeEach(() => {
    setPageUrl('https://pulp.example.com/ui/');
    setPageWidth(1400);
  });

  afterEach(resetPageWidth);

  it('shows the core version of the server once the plugin list answered', async () => {
    signIn();
    reportCore('3.49.1');

    renderShell();

    expect(await screen.findByText('Pulp 3.49.1')).toBeVisible();
  });

  it('shows no version before the plugin list answered', async () => {
    signIn();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('*/pulp/api/v3/status/', async () => {
        await gate;
        return HttpResponse.json({
          versions: [{ component: 'core', version: '3.49.1' }],
        });
      }),
    );

    renderShell();
    await screen.findByRole('link', { name: 'Skip to content' });

    expect(screen.queryByText(/^Pulp \d/)).not.toBeInTheDocument();

    release();
    expect(await screen.findByText('Pulp 3.49.1')).toBeVisible();
  });

  it('shows no version when the plugin list cannot be read', async () => {
    signIn();
    server.use(
      http.get('*/pulp/api/v3/status/', () =>
        HttpResponse.json({ detail: 'Failed.' }, { status: 500 }),
      ),
    );

    renderShell();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(screen.queryByText(/^Pulp \d/)).not.toBeInTheDocument();
  });

  it('does not show the version of the user interface build', async () => {
    signIn();
    reportCore('3.49.1');

    renderShell();
    await screen.findByText('Pulp 3.49.1');

    expect(screen.queryByText(/pulp-ui/i)).not.toBeInTheDocument();
  });

  it('keeps the host out of the footer on a wide screen', async () => {
    signIn();
    reportCore('3.49.1');

    renderShell();
    await screen.findByText('Pulp 3.49.1');

    const footer = sidebar().querySelector('.pulp-sidebar__footer');
    expect(footer).not.toHaveTextContent('pulp.example.com');
  });

  it('shows the host in the footer below the width of the persistent sidebar', async () => {
    setPageWidth(900);
    signIn();
    reportCore('3.49.1');

    renderShell();
    await screen.findByText('Pulp 3.49.1');

    const footer = sidebar().querySelector<HTMLElement>(
      '.pulp-sidebar__footer',
    ) as HTMLElement;
    expect(within(footer).getByText('pulp.example.com')).toBeInTheDocument();
  });
});

describe('sidebar before sign-in', () => {
  beforeEach(() => {
    setPageUrl('https://pulp.example.com/ui/');
    setPageWidth(1400);
  });

  afterEach(resetPageWidth);

  it('offers only Login: no Workers and status entry and no Operations label', async () => {
    renderShell();

    const nav = await within(sidebar()).findByRole('navigation', {
      name: 'Main',
    });
    await within(nav).findByRole('link', { name: 'Login' });

    expect(nav.querySelectorAll('a')).toHaveLength(1);
    expect(
      sidebar().querySelector('[data-cy=pulp-menu-item-login]'),
    ).not.toBeNull();
    expect(
      sidebar().querySelector('[data-cy=pulp-menu-item-status]'),
    ).toBeNull();
    expect(
      screen.queryByRole('heading', { name: 'Operations' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Workers and status')).not.toBeInTheDocument();
  });
});

describe('sidebar collapse', () => {
  beforeEach(() => {
    setPageUrl('https://pulp.example.com/ui/');
    setPageWidth(1400);
    reportCore('3.49.1');
  });

  afterEach(resetPageWidth);

  it('collapses from the footer button, remembers it and opens again from the top bar toggle', async () => {
    const { user } = renderShell();

    expect(isCollapsed()).toBe(false);
    expect(
      screen.queryByRole('button', { name: 'Expand sidebar' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    expect(isCollapsed()).toBe(true);
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('collapsed');

    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }));

    expect(isCollapsed()).toBe(false);
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('open');
  });

  it('starts collapsed when the browser remembers it', async () => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, 'collapsed');

    renderShell();

    expect(isCollapsed()).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Expand sidebar' }),
    ).toHaveAttribute('aria-expanded', 'false');
  });

  it('starts open when the browser remembers open', async () => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, 'open');

    renderShell();

    expect(isCollapsed()).toBe(false);
  });

  it.each(['', 'closed', 'COLLAPSED', 'true', '{"collapsed":true}'])(
    'counts the stored value "%s" as open',
    async (value) => {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, value);

      renderShell();

      expect(isCollapsed()).toBe(false);
    },
  );

  it('ignores the remembered choice below the width of the persistent sidebar', async () => {
    setPageWidth(900);
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, 'open');

    const { user } = renderShell();

    // The sidebar is a drawer there: closed on load whatever is remembered,
    // and opening it does not change what is remembered.
    expect(isCollapsed()).toBe(true);
    const toggle = screen.getByRole('button', { name: 'Open navigation' });
    await user.click(toggle);

    expect(isCollapsed()).toBe(false);
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('open');
    expect(
      screen.queryByRole('button', { name: 'Collapse sidebar' }),
    ).not.toBeInTheDocument();
  });

  it('does not apply a remembered collapse to a narrow screen', async () => {
    setPageWidth(900);
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, 'collapsed');

    const { user } = renderShell();
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));

    expect(isCollapsed()).toBe(false);
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('collapsed');
  });
});

describe('initial sidebar state', () => {
  afterEach(resetPageWidth);

  it('applies the remembered collapse only from the width of the persistent sidebar', () => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, 'collapsed');

    setPageWidth(1199);
    expect(initialSidebarOpen()).toBe(true);

    setPageWidth(1200);
    expect(initialSidebarOpen()).toBe(false);
  });

  it('starts open when nothing is remembered or the storage cannot be read', () => {
    setPageWidth(1400);
    expect(initialSidebarOpen()).toBe(true);

    const getItem = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('storage is blocked');
      });
    try {
      expect(initialSidebarOpen()).toBe(true);
    } finally {
      getItem.mockRestore();
    }
  });
});
