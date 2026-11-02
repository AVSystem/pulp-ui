import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listOf } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { config } from 'src/ui-config';
import { dataRoutes } from './app-routes';

// The guarded routes of the application, without the lazily loaded layout
// around them. Entries without a path (the index redirect) are left out.
const guardedRoutes = (dataRoutes[0]?.children?.[0]?.children ?? []).filter(
  (route) => 'path' in route,
);

function Routed() {
  const { pathname, search } = useLocation();
  return (
    <>
      <p data-testid='location'>{`${pathname}${search}`}</p>
      {useRoutes(guardedRoutes)}
    </>
  );
}

const PROTECTED_PATH = '/signature-keys';

// Holds the answer to GET login/ until the test releases it.
function holdSessionCheck(answer: () => Response) {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    http.get('*/pulp/api/v3/login/', async () => {
      await gate;
      return answer();
    }),
  );
  return release;
}

describe('route guard', () => {
  it('a protected route shows a loading state, not the login page, while the session check runs', async () => {
    const release = holdSessionCheck(() =>
      HttpResponse.json({ detail: 'Not authenticated.' }, { status: 401 }),
    );

    renderWithProviders(<Routed />, { route: PROTECTED_PATH });

    // Nothing has redirected while the check is pending.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId('location')).toHaveTextContent(
      new RegExp(`^${PROTECTED_PATH}$`),
    );
    expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();

    release();

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/login/),
    );
  });

  it('a protected route keeps its deep link when the session check answers 200', async () => {
    const { handler } = listOf('/pulp/api/v3/signing-services/', []);
    server.use(handler);
    const release = holdSessionCheck(() =>
      HttpResponse.json({
        username: 'zoe',
        pulp_href: '/pulp/api/v3/users/1/',
      }),
    );

    renderWithProviders(<Routed />, { route: PROTECTED_PATH });
    release();

    expect(
      await screen.findByRole('heading', { name: 'Signature keys' }),
    ).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent(
      new RegExp(`^${PROTECTED_PATH}$`),
    );
    expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();
  });

  it('a protected route redirects to the login page only when the session check answers 401', async () => {
    renderWithProviders(<Routed />, { route: PROTECTED_PATH });

    expect(await screen.findByLabelText(/username/i)).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent(
      `/login/?next=${encodeURIComponent(PROTECTED_PATH)}`,
    );
  });

  it('a protected route sends its full return URL, query string included, to the login page', async () => {
    const target = '/signature-keys?page=2&sort=name';
    renderWithProviders(<Routed />, { route: target });

    expect(await screen.findByLabelText(/username/i)).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent(
      `/login/?next=${encodeURIComponent(target)}`,
    );
  });

  it('a protected route without a query string sends the bare path, with no trailing question mark', async () => {
    renderWithProviders(<Routed />, { route: PROTECTED_PATH });

    expect(await screen.findByLabelText(/username/i)).toBeVisible();
    const shown = screen.getByTestId('location').textContent ?? '';
    expect(shown).toBe(`/login/?next=${encodeURIComponent(PROTECTED_PATH)}`);
    expect(decodeURIComponent(shown)).not.toContain('?next=/signature-keys?');
  });

  it('a protected route keeps encoded characters in the query string byte for byte', async () => {
    const target = '/signature-keys?name=%C5%BC&q=a%26b';
    renderWithProviders(<Routed />, { route: target });

    expect(await screen.findByLabelText(/username/i)).toBeVisible();
    const shown = screen.getByTestId('location').textContent ?? '';
    const next = new URL(shown, 'https://ui.example').searchParams.get('next');
    expect(next).toBe(target);
  });

  describe('with an external login address', () => {
    afterEach(() => {
      config.UI_EXTERNAL_LOGIN_URI = null;
      vi.restoreAllMocks();
    });

    it('a protected route passes the path with its query string to the external login address', async () => {
      config.UI_EXTERNAL_LOGIN_URI = 'https://login.example/start';
      const replace = vi
        .spyOn(window.location, 'replace')
        .mockImplementation(() => undefined);

      renderWithProviders(<Routed />, {
        route: '/signature-keys?page=2&sort=name',
      });

      await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
      expect(replace).toHaveBeenCalledWith(
        `https://login.example/start?next=${encodeURIComponent('/ui/signature-keys?page=2&sort=name')}`,
      );
    });
  });
});
