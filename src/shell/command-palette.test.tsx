import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { listOf, repository } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { CommandPalette } from './command-palette';

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

// Shows where the router is, so a test can see where a choice led.
const Where = () => (
  <output data-testid='where'>{useLocation().pathname}</output>
);

function renderPalette() {
  return renderWithProviders(
    <>
      <input aria-label='Some field' />
      <CommandPalette />
      <Where />
    </>,
    { route: '/tasks' },
  );
}

const trigger = () =>
  screen.findByRole('button', { name: 'Search or go to...' });
const input = () => screen.findByRole('combobox');
const where = () => screen.getByTestId('where').textContent;

const REPOSITORIES = '/pulp/api/v3/repositories/';

// A repository of the generic list: the plugin and type are in its address.
function repo(plugin: string, type: string, name: string) {
  return repository({
    name,
    pulp_href: `${REPOSITORIES}${plugin}/${type}/00000000-0000-4000-8000-${String(
      Math.floor(Math.random() * 1e12),
    ).padStart(12, '0')}/`,
  });
}

// Answers the generic repository list like the server's name filter does and
// records the query of every request.
function answerRepositories(rows: ReturnType<typeof repo>[]) {
  const { handler, queries } = listOf(REPOSITORIES, rows, {
    matching: (row, query) =>
      row.name
        .toLowerCase()
        .includes((query.get('name__icontains') ?? '').toLowerCase()),
  });
  server.use(handler);
  return queries;
}

// The pause the palette waits after the last keystroke, with some margin.
const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

// The names of the options in the order they are listed.
const optionNames = () =>
  screen.getAllByRole('option').map((option) => option.textContent);

// Waits until the screens of the menu are known, which they are once the list
// of installed plugins has answered.
async function openPalette(user: ReturnType<typeof renderPalette>['user']) {
  await user.click(await trigger());
  await input();
}

describe('search trigger', () => {
  it('is a button that names the shortcut for assistive technology', async () => {
    signIn();
    renderPalette();

    const button = await trigger();

    expect(button).toHaveAttribute('aria-keyshortcuts', 'Control+K Meta+K');
    expect(button).toHaveTextContent('Search or go to...');
    expect(button.querySelector('kbd')).toHaveTextContent(/^(Ctrl|Cmd) K$/);
  });

  it('opens the palette when clicked', async () => {
    signIn();
    const { user } = renderPalette();

    await user.click(await trigger());

    expect(
      await screen.findByRole('dialog', { name: 'Search or go to' }),
    ).toBeVisible();
  });
});

describe('keyboard shortcut', () => {
  it('opens the palette with Ctrl+K inside a text field and cancels the browser action', async () => {
    signIn();
    renderPalette();
    const field = screen.getByRole('textbox', { name: 'Some field' });
    field.focus();

    const notCancelled = fireEvent.keyDown(field, { key: 'k', ctrlKey: true });

    expect(notCancelled).toBe(false);
    expect(
      await screen.findByRole('dialog', { name: 'Search or go to' }),
    ).toBeVisible();
  });

  it('opens the palette with Cmd+K and cancels the browser action', async () => {
    signIn();
    renderPalette();

    const notCancelled = fireEvent.keyDown(document.body, {
      key: 'K',
      metaKey: true,
    });

    expect(notCancelled).toBe(false);
    expect(
      await screen.findByRole('dialog', { name: 'Search or go to' }),
    ).toBeVisible();
  });

  it('does nothing for Ctrl+Alt+K', async () => {
    signIn();
    renderPalette();
    await trigger();

    const notCancelled = fireEvent.keyDown(document.body, {
      key: 'k',
      ctrlKey: true,
      altKey: true,
    });

    expect(notCancelled).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does nothing for K alone', async () => {
    signIn();
    renderPalette();
    await trigger();

    fireEvent.keyDown(document.body, { key: 'k' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('keyboard shortcut while a dialog is open', () => {
  it('keeps the place to return to when pressed inside the open palette', async () => {
    signIn();
    const { user } = renderPalette();
    // A collapsed sidebar cannot take the focus back, so the field that had it
    // before the palette opened is the place to return to.
    (await trigger()).setAttribute('disabled', '');
    const field = screen.getByRole('textbox', { name: 'Some field' });
    field.focus();
    fireEvent.keyDown(field, { key: 'k', ctrlKey: true });
    const box = await input();

    const notCancelled = fireEvent.keyDown(box, { key: 'k', ctrlKey: true });
    await user.keyboard('{Escape}');

    // The browser's own use of the key is still cancelled.
    expect(notCancelled).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(field).toHaveFocus();
  });

  it('does not open over another dialog', async () => {
    signIn();
    renderWithProviders(
      <>
        <CommandPalette />
        <div className='pf-v6-c-modal-box' role='dialog' aria-label='Other'>
          <button type='button'>Inside</button>
        </div>
      </>,
    );
    const inside = screen.getByRole('button', { name: 'Inside' });
    inside.focus();

    const notCancelled = fireEvent.keyDown(inside, { key: 'k', ctrlKey: true });

    expect(notCancelled).toBe(false);
    expect(
      screen.queryByRole('dialog', { name: 'Search or go to' }),
    ).not.toBeInTheDocument();
    expect(inside).toHaveFocus();
  });
});

describe('palette', () => {
  it('focuses a combobox that controls a listbox of options', async () => {
    signIn();
    const { user } = renderPalette();

    await openPalette(user);

    const box = await input();
    expect(box).toHaveFocus();
    expect(box).toHaveAttribute('aria-expanded', 'true');
    expect(box).toHaveAttribute(
      'placeholder',
      'Search screens and repositories',
    );
    const list = screen.getByRole('listbox');
    expect(box.getAttribute('aria-controls')).toBe(list.id);
    expect(
      screen.getByText('Up and Down to move, Enter to open, Esc to close'),
    ).toBeVisible();
  });

  it('lists up to 8 reachable screens in sidebar order for an empty query without any request', async () => {
    // Any request without a handler fails the test (msw onUnhandledRequest).
    signIn();
    const { user } = renderPalette();

    await openPalette(user);
    await screen.findAllByRole('option');

    expect(optionNames()).toEqual([
      'Repositories - File',
      'Repositories - deb',
      'Repositories - RPM',
      'Repositories - Python',
      'Repositories - Ansible',
      'Packages and artifacts - RPM',
      'Packages and artifacts - Python',
      'Remotes - File',
    ]);
    expect(screen.getByText('Go to')).toBeVisible();
  });

  it('announces the number of results politely', async () => {
    signIn();
    const { user } = renderPalette();

    await openPalette(user);
    await screen.findAllByRole('option');

    const live = document.querySelector('[aria-live="polite"]');
    expect(live).toHaveTextContent('8 results');
  });

  it('filters screens by a case-insensitive substring from the first character', async () => {
    signIn();
    const { user } = renderPalette();
    await openPalette(user);
    await screen.findAllByRole('option');

    await user.type(await input(), 'u');

    expect(optionNames()).toEqual([
      'Workers and status',
      'Users and groups - Users',
      'Users and groups - Groups',
    ]);
  });

  it('opens the highlighted screen with Enter and closes', async () => {
    signIn();
    const { user } = renderPalette();
    await openPalette(user);
    await screen.findAllByRole('option');

    answerRepositories([]);
    await user.type(await input(), 'Rem');
    await user.keyboard('{ArrowDown}');
    const box = await input();
    const highlighted = screen.getByRole('option', {
      name: 'Remotes - deb',
    });
    expect(box.getAttribute('aria-activedescendant')).toBe(highlighted.id);
    await user.keyboard('{Enter}');

    expect(where()).toMatch(/^\/deb\/remotes\/?$/);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not open the highlighted screen when Enter ends a text composition', async () => {
    signIn();
    const { user } = renderPalette();
    await openPalette(user);
    await screen.findAllByRole('option');
    const box = await input();

    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });

    expect(where()).toBe('/tasks');
    expect(screen.getByRole('dialog')).toBeVisible();

    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(where()).not.toBe('/tasks'));
  });

  it('opens a screen with a click', async () => {
    signIn();
    const { user } = renderPalette();
    await openPalette(user);

    await user.click(
      await screen.findByRole('option', { name: 'Repositories - deb' }),
    );

    expect(where()).toMatch(/^\/deb\/repositories\/?$/);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('moves the highlight with Up and Down and wraps at both ends', async () => {
    signIn();
    const { user } = renderPalette();
    await openPalette(user);
    await screen.findAllByRole('option');
    const box = await input();
    const names = optionNames();
    const active = () =>
      screen
        .getAllByRole('option')
        .findIndex(
          (option) => option.id === box.getAttribute('aria-activedescendant'),
        );

    expect(active()).toBe(0);
    await user.keyboard('{ArrowUp}');
    expect(active()).toBe(names.length - 1);
    await user.keyboard('{ArrowDown}');
    expect(active()).toBe(0);
    await user.keyboard('{ArrowDown}');
    expect(active()).toBe(1);
  });

  it('scrolls the highlighted option into view when the highlight moves', async () => {
    signIn();
    const scroll = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(() => undefined);
    try {
      const { user } = renderPalette();
      await openPalette(user);
      await screen.findAllByRole('option');
      const box = await input();
      scroll.mockClear();

      // The element each call was made on, and the options it was made with.
      const lastScrolled = () => (scroll.mock.contexts.at(-1) as Element).id;
      expect(scroll.mock.calls.every(([o]) => o?.['block'] === 'nearest')).toBe(
        true,
      );

      await user.keyboard('{ArrowUp}');
      expect(lastScrolled()).toBe(box.getAttribute('aria-activedescendant'));
      const last = lastScrolled();
      expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest' });

      await user.keyboard('{ArrowDown}');
      expect(lastScrolled()).toBe(box.getAttribute('aria-activedescendant'));
      expect(lastScrolled()).not.toBe(last);
    } finally {
      scroll.mockRestore();
    }
  });

  it('closes on Escape and returns the focus to the trigger', async () => {
    signIn();
    const { user } = renderPalette();
    await openPalette(user);

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await trigger()).toHaveFocus();
  });

  it('closes when the page outside the dialog is pressed and stays open for a press inside', async () => {
    signIn();
    const { user } = renderPalette();
    await openPalette(user);

    fireEvent.mouseDown(await input());
    expect(screen.getByRole('dialog')).toBeVisible();
    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('has no close button, so a pointer user leaves by pressing outside or choosing', async () => {
    signIn();
    const { user } = renderPalette();
    await openPalette(user);

    expect(within(screen.getByRole('dialog')).queryByRole('button')).toBeNull();
  });

  it('keeps the Tab key inside the modal', async () => {
    signIn();
    const { user } = renderPalette();
    await openPalette(user);
    await screen.findAllByRole('option');

    await user.tab();
    await user.tab();
    await user.tab();

    expect(
      within(screen.getByRole('dialog')).queryByRole('combobox'),
    ).not.toBeNull();
    expect(screen.getByRole('dialog')).toContainElement(
      document.activeElement as HTMLElement,
    );
  });

  it('offers only the sign-in screen to a visitor who is not signed in', async () => {
    const { user } = renderPalette();

    await openPalette(user);
    await screen.findAllByRole('option');

    expect(optionNames()).toEqual(['Login']);
  });
});

describe('repository search', () => {
  it('sends no repository request for a single character', async () => {
    signIn();
    const queries = answerRepositories([repo('deb', 'apt', 'dev-repo')]);
    const { user } = renderPalette();
    await openPalette(user);

    await user.type(await input(), 'd');
    await settle();

    expect(queries).toHaveLength(0);
    expect(screen.queryByRole('group', { name: 'Repositories' })).toBeNull();
  });

  it('sends exactly one request for the final text of a quickly typed word', async () => {
    signIn();
    const queries = answerRepositories([repo('deb', 'apt', 'debian-main')]);
    const { user } = renderPalette();
    await openPalette(user);

    await user.type(await input(), 'deb');
    expect(queries).toHaveLength(0);
    await screen.findByRole('option', { name: /debian-main/ });
    await settle();

    expect(queries).toHaveLength(1);
    expect(Array.from(queries[0].keys()).sort()).toEqual([
      'limit',
      'name__icontains',
      'offset',
    ]);
    expect(queries[0].get('name__icontains')).toBe('deb');
    expect(queries[0].get('limit')).toBe('50');
  });

  it('groups the results by repository type, five at most each, with the plugin in the right column', async () => {
    signIn();
    answerRepositories([
      ...[1, 2, 3, 4, 5, 6, 7].map((n) => repo('deb', 'apt', `zz-deb-${n}`)),
      repo('file', 'file', 'zz-file-1'),
      repo('rpm', 'rpm', 'zz-rpm-1'),
      repo('python', 'python', 'zz-python-1'),
      repo('ansible', 'ansible', 'zz-ansible-1'),
      repo('container', 'container', 'zz-container-1'),
    ]);
    const { user } = renderPalette();
    await openPalette(user);

    await user.type(await input(), 'zz');
    const group = await screen.findByRole('group', { name: 'Repositories' });

    const rows = (await within(group).findAllByRole('option')).map((option) =>
      option.getAttribute('aria-label'),
    );
    expect(rows).toEqual([
      'zz-deb-1, deb',
      'zz-deb-2, deb',
      'zz-deb-3, deb',
      'zz-deb-4, deb',
      'zz-deb-5, deb',
      'zz-file-1, File',
      'zz-rpm-1, RPM',
      'zz-python-1, Python',
      'zz-ansible-1, Ansible',
    ]);
  });

  it('leaves out the repositories of a plugin that is not installed', async () => {
    signIn();
    server.use(
      http.get('*/pulp/api/v3/status/', () =>
        HttpResponse.json({
          versions: ['core', 'file', 'deb'].map((component) => ({
            component,
            version: '3.0.0',
          })),
        }),
      ),
    );
    answerRepositories([
      repo('deb', 'apt', 'zz-deb-1'),
      repo('rpm', 'rpm', 'zz-rpm-1'),
    ]);
    const { user } = renderPalette();
    await openPalette(user);
    await screen.findAllByRole('option');

    await user.type(await input(), 'zz');
    await screen.findByRole('option', { name: 'zz-deb-1, deb' });

    expect(screen.queryByRole('option', { name: /zz-rpm-1/ })).toBeNull();
  });

  it('shows a long name on one line with the whole name as its title', async () => {
    signIn();
    const name = `zz-${'long-'.repeat(30)}end`;
    answerRepositories([repo('deb', 'apt', name)]);
    const { user } = renderPalette();
    await openPalette(user);

    await user.type(await input(), 'zz');
    const row = await screen.findByRole('option', { name: `${name}, deb` });

    expect(within(row).getByText(name)).toHaveAttribute('title', name);
  });

  it('shows a name as text, never as markup', async () => {
    signIn();
    const name = 'zz-<b>bold</b><img src=x>';
    answerRepositories([repo('file', 'file', name)]);
    const { user } = renderPalette();
    await openPalette(user);

    await user.type(await input(), 'zz');
    const row = await screen.findByRole('option', { name: `${name}, File` });

    expect(row.querySelector('b, img')).toBeNull();
  });

  it('opens the detail screen of the chosen repository with Enter', async () => {
    signIn();
    answerRepositories([repo('deb', 'apt', 'zz-deb-1')]);
    const { user } = renderPalette();
    await openPalette(user);

    await user.type(await input(), 'zz');
    await screen.findByRole('option', { name: 'zz-deb-1, deb' });
    await user.keyboard('{Enter}');

    expect(where()).toBe('/deb/repositories/detail/zz-deb-1/');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a spinner and a message while the request runs, with the screens already listed', async () => {
    signIn();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`*${REPOSITORIES}`, async () => {
        await gate;
        return HttpResponse.json({
          count: 0,
          next: null,
          previous: null,
          results: [],
        });
      }),
    );
    const { user } = renderPalette();
    await openPalette(user);

    await user.type(await input(), 'rep');

    expect(await screen.findByText('Searching repositories...')).toBeVisible();
    expect(
      screen.getByRole('option', { name: 'Repositories - deb' }),
    ).toBeVisible();
    release();
    await waitFor(() =>
      expect(screen.queryByText('Searching repositories...')).toBeNull(),
    );
  });

  it('leaves the Repositories group out without a message when the server refuses the request', async () => {
    signIn();
    server.use(
      http.get(`*${REPOSITORIES}`, () =>
        HttpResponse.json({ detail: 'refused' }, { status: 403 }),
      ),
    );
    const { user } = renderPalette();
    await openPalette(user);

    await user.type(await input(), 'rep');
    await waitFor(() =>
      expect(screen.queryByText('Searching repositories...')).toBeNull(),
    );

    expect(screen.queryByRole('group', { name: 'Repositories' })).toBeNull();
    expect(screen.queryByText(/could not be searched/)).toBeNull();
    expect(screen.queryByText('refused')).toBeNull();
    expect(
      screen.getByRole('option', { name: 'Repositories - deb' }),
    ).toBeVisible();
  });

  it('says repositories cannot be searched, not that nothing matches, when the request is refused and no screen matches', async () => {
    signIn();
    server.use(
      http.get(`*${REPOSITORIES}`, () =>
        HttpResponse.json({ detail: 'refused' }, { status: 403 }),
      ),
    );
    const { user } = renderPalette();
    await openPalette(user);

    await user.type(await input(), 'qqzz');

    expect(
      await screen.findByText(
        'Repositories cannot be searched with your account.',
      ),
    ).toBeVisible();
    expect(screen.queryByText('No screens or repositories match')).toBeNull();
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('does not announce "No results" while the repositories are still being searched', async () => {
    signIn();
    server.use(
      http.get(`*${REPOSITORIES}`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return HttpResponse.json({
          count: 0,
          next: null,
          previous: null,
          results: [],
        });
      }),
    );
    const { user } = renderPalette();
    await openPalette(user);

    await user.type(await input(), 'qqzz');

    const live = document.querySelector('[aria-live="polite"]');
    await screen.findByText('Searching repositories...', {
      selector: '.pulp-palette__status',
    });
    expect(live).toHaveTextContent('Searching repositories...');
    expect(live).not.toHaveTextContent('No results');
    await waitFor(() => expect(live).toHaveTextContent('No results'));
  });

  it('shows one muted row with a retry for any other failure and asks again on retry', async () => {
    signIn();
    let calls = 0;
    server.use(
      http.get(`*${REPOSITORIES}`, () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ detail: 'database exploded' }, { status: 500 })
          : HttpResponse.json({
              count: 1,
              next: null,
              previous: null,
              results: [repo('deb', 'apt', 'zz-deb-1')],
            });
      }),
    );
    const { user } = renderPalette();
    await openPalette(user);

    await user.type(await input(), 'zz');
    expect(
      await screen.findByText('Some repository lists could not be searched.'),
    ).toBeVisible();
    expect(screen.queryByText(/database exploded/)).toBeNull();
    expect(screen.queryByText('No screens or repositories match')).toBeNull();

    await user.click(
      screen.getByRole('button', { name: 'Retry repository search' }),
    );

    expect(
      await screen.findByRole('option', { name: 'zz-deb-1, deb' }),
    ).toBeVisible();
    expect(calls).toBe(2);
    expect(screen.queryByText(/could not be searched/)).toBeNull();
  });

  it('keeps the screens when the repository request fails', async () => {
    signIn();
    server.use(
      http.get(`*${REPOSITORIES}`, () =>
        HttpResponse.json({ detail: 'x' }, { status: 500 }),
      ),
    );
    const { user } = renderPalette();
    await openPalette(user);

    await user.type(await input(), 'rep');
    await screen.findByText('Some repository lists could not be searched.');

    expect(
      screen.getByRole('option', { name: 'Repositories - deb' }),
    ).toBeVisible();
  });

  it('says nothing matches when no screen and no repository does', async () => {
    signIn();
    answerRepositories([repo('deb', 'apt', 'other')]);
    const { user } = renderPalette();
    await openPalette(user);

    await user.type(await input(), 'qqzz');

    expect(
      await screen.findByRole('heading', {
        name: 'No screens or repositories match',
      }),
    ).toBeVisible();
    expect(
      screen.getByText(
        'Nothing matches "qqzz". Check the spelling or try part of a repository name.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('does not show the no-match message while the repositories are still being searched', async () => {
    signIn();
    server.use(
      http.get(`*${REPOSITORIES}`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return HttpResponse.json({
          count: 0,
          next: null,
          previous: null,
          results: [],
        });
      }),
    );
    const { user } = renderPalette();
    await openPalette(user);

    await user.type(await input(), 'qqzz');

    expect(
      await screen.findByText('Searching repositories...', {
        selector: '.pulp-palette__status',
      }),
    ).toBeVisible();
    expect(screen.queryByText('No screens or repositories match')).toBeNull();
    expect(
      await screen.findByText('No screens or repositories match'),
    ).toBeVisible();
  });

  it('ignores a late answer to an earlier query', async () => {
    signIn();
    let releaseFirst: () => void = () => undefined;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const page = (names: string[]) =>
      HttpResponse.json({
        count: names.length,
        next: null,
        previous: null,
        results: names.map((name) => repo('deb', 'apt', name)),
      });
    server.use(
      http.get(`*${REPOSITORIES}`, async ({ request }) => {
        const text = new URL(request.url).searchParams.get('name__icontains');
        if (text === 'zz') {
          await first;
          return page(['zz-old']);
        }
        return page(['zzz-new']);
      }),
    );
    const { user } = renderPalette();
    await openPalette(user);

    await user.type(await input(), 'zz');
    await settle();
    await user.type(await input(), 'z');
    await screen.findByRole('option', { name: 'zzz-new, deb' });
    releaseFirst();
    await settle();

    expect(screen.queryByRole('option', { name: /zz-old/ })).toBeNull();
    expect(screen.getByRole('option', { name: 'zzz-new, deb' })).toBeVisible();
  });

  it('sends no repository request for a visitor who is not signed in', async () => {
    // Any request without a handler fails the test (msw onUnhandledRequest).
    const { user } = renderPalette();
    await openPalette(user);

    await user.type(await input(), 'login');
    await settle();

    expect(screen.getByRole('option', { name: 'Login' })).toBeVisible();
  });

  it('announces the number of all rows including repositories', async () => {
    signIn();
    answerRepositories([
      repo('deb', 'apt', 'zz-deb-1'),
      repo('file', 'file', 'zz-file-1'),
    ]);
    const { user } = renderPalette();
    await openPalette(user);

    await user.type(await input(), 'zz');
    await screen.findByRole('option', { name: 'zz-deb-1, deb' });

    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(
      '2 results',
    );
  });
});
