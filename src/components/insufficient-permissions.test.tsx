import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { serveUserRecords } from '../test-utils/permissions';
import { renderWithProviders } from '../test-utils/render';
import { server } from '../test-utils/server';
import { config } from '../ui-config';
import { UserContextProvider } from '../user-context';
import { InsufficientPermissions } from './insufficient-permissions';

const signedIn = () => {
  serveUserRecords({ id: 1, isStaff: true });
  server.use(
    http.get('*/pulp/api/v3/login/', () =>
      HttpResponse.json({
        username: 'zoe',
        pulp_href: '/pulp/api/v3/users/1/',
      }),
    ),
  );
};

afterEach(() => {
  window.history.replaceState(null, '');
  config.UI_EXTERNAL_LOGIN_URI = null;
});

describe('the insufficient permissions page', () => {
  it('shows the title, the sentence, the server text, the hint and both actions', async () => {
    signedIn();
    renderWithProviders(<InsufficientPermissions detail='nope' />, {
      route: '/things',
    });

    expect(
      screen.getByRole('heading', { name: 'Insufficient permissions' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('You do not have permission to view this page.'),
    ).toBeInTheDocument();
    expect(screen.getByText('nope')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Contact your organization administrator for more information.',
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Go back' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Go to the start page' }),
    ).toHaveAttribute('href', '/status/');
  });

  it('has no Retry button and no error state', async () => {
    signedIn();
    renderWithProviders(<InsufficientPermissions detail='nope' />);

    await screen.findByRole('button', { name: 'Go back' });
    expect(
      screen.queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument();
  });

  it('shows markup in the server text literally and creates no element from it', () => {
    const { container } = renderWithProviders(
      <InsufficientPermissions detail='<img src=x onerror=alert(1)> <b>bold</b>' />,
    );

    expect(
      screen.getByText('<img src=x onerror=alert(1)> <b>bold</b>'),
    ).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it.each([undefined, '', '   '])(
    'omits the detail paragraph when the detail is %j',
    (detail) => {
      renderWithProviders(<InsufficientPermissions detail={detail} />);

      expect(
        screen.getByText('You do not have permission to view this page.'),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'Contact your organization administrator for more information.',
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole('status').querySelectorAll('p')).toHaveLength(2);
    },
  );

  it('puts the server text in an element that wraps unbroken text', () => {
    renderWithProviders(<InsufficientPermissions detail={'x'.repeat(500)} />);

    expect(screen.getByText('x'.repeat(500))).toHaveClass(
      'pulp-break-anywhere',
    );
  });

  it('is announced through a status region', () => {
    renderWithProviders(<InsufficientPermissions detail='nope' />);

    expect(screen.getByRole('status')).toContainElement(
      screen.getByText('You do not have permission to view this page.'),
    );
  });

  it('offers the Login link with the current address and no Go back when nobody is signed in', async () => {
    renderWithProviders(<InsufficientPermissions detail='nope' />, {
      route: '/things?page=2',
    });

    expect(await screen.findByRole('link', { name: 'Login' })).toHaveAttribute(
      'href',
      `/login/?next=${encodeURIComponent('/things?page=2')}`,
    );
    expect(
      screen.queryByRole('button', { name: 'Go back' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Go to the start page' }),
    ).toBeInTheDocument();
  });
});

function Where() {
  const { pathname } = useLocation();
  return <p data-testid='where'>{pathname}</p>;
}

function renderInHistory(entries: string[], index: number) {
  const user = userEvent.setup();
  render(
    <I18nProvider i18n={i18n}>
      <UserContextProvider>
        <MemoryRouter initialEntries={entries} initialIndex={index}>
          <Where />
          <Routes>
            <Route path='*' element={<InsufficientPermissions />} />
          </Routes>
        </MemoryRouter>
      </UserContextProvider>
    </I18nProvider>,
  );
  return user;
}

describe('Go back', () => {
  it('returns to the previous entry when the app has one', async () => {
    signedIn();
    window.history.replaceState({ idx: 1 }, '');
    const user = renderInHistory(['/before', '/refused'], 1);

    await user.click(await screen.findByRole('button', { name: 'Go back' }));

    expect(screen.getByTestId('where')).toHaveTextContent('/before');
  });

  it('goes to the start page when the app has no previous entry', async () => {
    signedIn();
    window.history.replaceState({ idx: 0 }, '');
    const user = renderInHistory(['/refused'], 0);

    await user.click(await screen.findByRole('button', { name: 'Go back' }));

    expect(screen.getByTestId('where')).toHaveTextContent('/status');
  });

  it('goes to the start page when the history entry carries no index', async () => {
    signedIn();
    const user = renderInHistory(['/before', '/refused'], 1);

    await user.click(await screen.findByRole('button', { name: 'Go back' }));

    expect(screen.getByTestId('where')).toHaveTextContent('/status');
  });
});
