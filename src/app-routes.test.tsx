import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation, useRoutes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { listOf } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
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
});
