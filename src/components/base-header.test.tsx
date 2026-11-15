import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ReactNode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Shell } from 'src/shell/shell';
import { resetPageWidth, setPageUrl, setPageWidth } from 'src/test-utils/page';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { BaseHeader } from './base-header';
import { Breadcrumbs } from './breadcrumbs';

const LONG = 'a-repository-name-that-is-much-too-long-for-the-top-bar-'.repeat(
  2,
);

function renderScreen(screenNode: ReactNode, route = '/tasks') {
  return renderWithProviders(<Shell>{screenNode}</Shell>, { route });
}

const trail = () => screen.getByRole('navigation', { name: 'Breadcrumb' });

describe('base header', () => {
  beforeEach(() => {
    setPageUrl('https://pulp.example.com/ui/');
    setPageWidth(1400);
  });

  afterEach(resetPageWidth);

  it('shows the trail of a screen in the top bar and not in the page', () => {
    renderScreen(
      <BaseHeader
        title='Thing one'
        breadcrumbs={
          <Breadcrumbs
            links={[{ name: 'Things', url: '/things' }, { name: 'Thing one' }]}
          />
        }
      />,
    );

    const banner = screen.getByRole('banner');
    expect(
      within(banner).getByRole('navigation', { name: 'Breadcrumb' }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('main')).queryByRole('navigation', {
        name: 'Breadcrumb',
      }),
    ).toBeNull();
    expect(
      screen.getAllByRole('navigation', { name: 'Breadcrumb' }),
    ).toHaveLength(1);
    expect(
      within(trail()).getByRole('link', { name: 'Things' }),
    ).toHaveAttribute('href', '/things');
  });

  it('shows the last crumb as plain text carrying its full name in a title', () => {
    renderScreen(
      <BaseHeader
        title='Thing one'
        breadcrumbs={
          <Breadcrumbs
            links={[{ name: 'Things', url: '/things' }, { name: LONG }]}
          />
        }
      />,
    );

    const current = within(trail()).getByText(LONG);
    expect(current.closest('a')).toBeNull();
    expect(current).toHaveAttribute('title', LONG);
    expect(
      within(trail()).getByRole('link', { name: 'Things' }),
    ).toHaveAttribute('title', 'Things');
  });

  it('clears the trail when the screen goes away', async () => {
    function Switch() {
      const [shown, setShown] = useState(true);
      return (
        <>
          <button onClick={() => setShown(false)}>leave</button>
          {shown ? (
            <BaseHeader
              title='Thing one'
              breadcrumbs={<Breadcrumbs links={[{ name: 'Thing one' }]} />}
            />
          ) : null}
        </>
      );
    }
    const { user } = renderScreen(<Switch />, '/nowhere');

    expect(within(trail()).getByText('Thing one')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'leave' }));

    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull();
  });

  it('shows one plain crumb with the sidebar label for a screen without a trail', async () => {
    server.use(
      http.get('*/pulp/api/v3/login/', () =>
        HttpResponse.json({
          username: 'zoe',
          pulp_href: '/pulp/api/v3/users/1/',
        }),
      ),
    );
    renderScreen(<BaseHeader title='Task management' />, '/tasks');

    await within(trail()).findByText('Tasks');
    const crumbs = within(trail()).getAllByRole('listitem');
    expect(crumbs).toHaveLength(1);
    expect(crumbs[0]).toHaveTextContent('Tasks');
    expect(within(trail()).queryByRole('link')).toBeNull();
  });

  it('falls back to the page title when no sidebar entry leads to the screen', () => {
    renderScreen(<BaseHeader title='Some page' />, '/nowhere');

    expect(within(trail()).getByText('Some page')).toBeInTheDocument();
  });

  it('collapses to the parent and the last crumb on a phone', () => {
    setPageWidth(400);
    renderScreen(
      <BaseHeader
        title='Thing one'
        breadcrumbs={
          <Breadcrumbs
            links={[
              { name: 'Things', url: '/things' },
              { name: 'Group', url: '/things/group' },
              { name: 'Thing one' },
            ]}
          />
        }
      />,
    );

    expect(within(trail()).queryByText('Things')).toBeNull();
    expect(within(trail()).getByText('Thing one')).toBeInTheDocument();
    expect(
      within(trail()).getByRole('link', { name: 'Group' }),
    ).toHaveAttribute('href', '/things/group');
  });

  it('renders the page title as the only h1 with the large title size', () => {
    renderScreen(<BaseHeader title='Thing one' />);

    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Thing one');
    expect(headings[0]).toHaveClass('pf-m-3xl');
    expect(document.title).toBe('Pulp UI - Thing one');
  });
});

describe('the header row stylesheet', () => {
  const css = readFileSync(
    resolve(process.cwd(), 'src/components/header.scss'),
    'utf8',
  );
  const rule = (selector: string) =>
    css.slice(css.indexOf(selector)).split('}')[0];

  it('keeps the title row at least 36px high, so actions appearing later move nothing', () => {
    expect(rule('.pulp-header__row {')).toMatch(/min-block-size: 36px;/);
  });

  it('keeps the title row at least 44px high on a phone, where controls are that tall', () => {
    expect(css).toMatch(
      /@media \(max-width: 767px\) \{\s*\.pulp-header__row \{\s*min-block-size: 44px;/,
    );
  });
});
