import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import PulpLoginPage from './login';

function renderLogin(route = '/login') {
  return renderWithProviders(
    <Routes>
      <Route path='/login' element={<PulpLoginPage />} />
      <Route path='/status' element={<p>Status page</p>} />
    </Routes>,
    { route },
  );
}

// Two letters outside Latin-1, so a header encoded any other way than UTF-8 is
// told apart from a correct one.
const password = 'p\u0105\u0142-secret';

describe('login page', () => {
  it('signing in sends one POST login/ with a UTF-8 Basic header and stores nothing', async () => {
    const posts: {
      method: string;
      path: string;
      authorization: string | null;
      requestedWith: string | null;
    }[] = [];
    server.use(
      http.post('*/pulp/api/v3/login/', ({ request }) => {
        posts.push({
          method: request.method,
          path: new URL(request.url).pathname,
          authorization: request.headers.get('authorization'),
          requestedWith: request.headers.get('x-requested-with'),
        });
        return HttpResponse.json(
          { username: 'zoe', pulp_href: '/pulp/api/v3/users/1/' },
          { status: 201 },
        );
      }),
    );

    const { user } = renderLogin();

    await user.type(await screen.findByLabelText(/username/i), 'zoe');
    await user.type(screen.getByLabelText(/^password/i), password);
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    await screen.findByText('Status page');

    expect(posts).toHaveLength(1);
    expect(posts[0]?.method).toBe('POST');
    expect(posts[0]?.path).toBe('/pulp/api/v3/login/');
    expect(posts[0]?.authorization).toMatch(/^Basic /);
    expect(
      Buffer.from(
        (posts[0]?.authorization ?? '').slice('Basic '.length),
        'base64',
      ).toString('utf8'),
    ).toBe(`zoe:${password}`);
    expect(posts[0]?.requestedWith).toBe('XMLHttpRequest');

    for (const storage of [window.localStorage, window.sessionStorage]) {
      const everything = JSON.stringify(Object.entries(storage));
      expect(everything).not.toContain(password);
      expect(storage.getItem('credentials')).toBeNull();
    }
    expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();
  });

  it('a refused login shows the server message and stays on the page', async () => {
    server.use(
      http.post('*/pulp/api/v3/login/', () =>
        HttpResponse.json(
          { detail: 'Invalid username/password.' },
          { status: 401 },
        ),
      ),
    );

    const { user } = renderLogin();

    await user.type(await screen.findByLabelText(/username/i), 'zoe');
    await user.type(screen.getByLabelText(/^password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() =>
      expect(screen.getByText(/Invalid username\/password/)).toBeVisible(),
    );
    expect(screen.queryByText('Status page')).not.toBeInTheDocument();
  });
});
