import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import PulpLoginPage from './login';

// Prints where the router ended up, for routes the test does not render.
function LocationProbe() {
  const { pathname, search } = useLocation();
  return <p data-testid='location'>{`${pathname}${search}`}</p>;
}

function renderLogin(route = '/login') {
  return renderWithProviders(
    <Routes>
      <Route path='/login' element={<PulpLoginPage />} />
      <Route path='/status' element={<p>Status page</p>} />
      <Route path='*' element={<LocationProbe />} />
    </Routes>,
    { route },
  );
}

async function signIn(
  user: ReturnType<typeof renderLogin>['user'],
  name: string,
  secret: string,
) {
  await user.type(await screen.findByLabelText(/username/i), name);
  await user.type(screen.getByLabelText(/^password/i), secret);
  await user.click(screen.getByRole('button', { name: 'Log in' }));
}

function acceptLogin() {
  server.use(
    http.post('*/pulp/api/v3/login/', () =>
      HttpResponse.json(
        { username: 'zoe', pulp_href: '/pulp/api/v3/users/1/' },
        { status: 201 },
      ),
    ),
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

  it('a refused login for a user name with Polish letters shows the server message and raises no error', async () => {
    // Polish letters outside Latin-1 in the user name: a header built any other
    // way than from UTF-8 bytes throws before the request is sent.
    const name = '\u017b\u00f3\u0142w-\u0107wik';
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    const seen: { authorization: string | null }[] = [];
    server.use(
      http.post('*/pulp/api/v3/login/', ({ request }) => {
        seen.push({ authorization: request.headers.get('authorization') });
        return HttpResponse.json(
          { detail: 'Invalid username/password.' },
          { status: 401 },
        );
      }),
    );

    try {
      const { user } = renderLogin();
      await signIn(user, name, 'wrong');

      await waitFor(() =>
        expect(screen.getByText(/Invalid username\/password/)).toBeVisible(),
      );
      // Give a stray rejection the chance to surface before asserting.
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }

    expect(unhandled).toEqual([]);
    expect(seen).toHaveLength(1);
    expect(
      Buffer.from(
        (seen[0]?.authorization ?? '').slice('Basic '.length),
        'base64',
      ).toString('utf8'),
    ).toBe(`${name}:wrong`);
    expect(screen.queryByText('Status page')).not.toBeInTheDocument();
  });

  it('an unreachable server shows that the server could not be reached', async () => {
    server.use(http.post('*/pulp/api/v3/login/', () => HttpResponse.error()));

    const { user } = renderLogin();
    await signIn(user, 'zoe', 'secret');

    await waitFor(() =>
      expect(screen.getByText(/could not be reached/i)).toBeVisible(),
    );
    expect(screen.queryByText('Status page')).not.toBeInTheDocument();
  });

  it('the page offers no remember option and no plain-text storage warning', async () => {
    renderLogin();

    await screen.findByLabelText(/username/i);

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/remember/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/plain.?text/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/stored/i)).not.toBeInTheDocument();
  });

  it('a protocol-relative next target is ignored and sign-in ends on the status page', async () => {
    acceptLogin();

    const { user } = renderLogin('/login/?next=//evil.example');
    await signIn(user, 'zoe', 'secret');

    await screen.findByText('Status page');
    expect(screen.queryByTestId('location')).not.toBeInTheDocument();
  });

  it('a same-origin next path is honoured after sign-in', async () => {
    acceptLogin();

    const { user } = renderLogin('/login/?next=/file/repositories/');
    await signIn(user, 'zoe', 'secret');

    expect(await screen.findByTestId('location')).toHaveTextContent(
      '/file/repositories/',
    );
    expect(screen.queryByText('Status page')).not.toBeInTheDocument();
  });
});
