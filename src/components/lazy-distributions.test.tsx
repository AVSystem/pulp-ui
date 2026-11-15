import { act, screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { resetSessionEvents } from '../session/session-events';
import { listOf } from '../test-utils/pulp';
import { renderWithProviders } from '../test-utils/render';
import { server } from '../test-utils/server';
import {
  SignInAgain,
  serveSignIn,
  signedIn,
} from '../test-utils/sign-in-again';
import { LazyDistributions } from './lazy-distributions';

const API = '/pulp/api/v3';
const DISTRIBUTIONS = `${API}/distributions/ansible/ansible/`;
const REPOSITORY = `${API}/repositories/ansible/ansible/00000000-0000-4000-8000-0000000000aa/`;

const distribution = (name: string) => ({
  pulp_href: `${DISTRIBUTIONS}${name}/`,
  name,
  base_path: name,
  client_url: `https://pulp.example/pulp_ansible/galaxy/${name}/`,
  repository: REPOSITORY,
  pulp_created: '2024-01-01T00:00:00Z',
});

const refused = http.get(`*${DISTRIBUTIONS}`, () =>
  HttpResponse.json({ detail: 'no' }, { status: 401 }),
);

function renderAfterSignIn() {
  serveSignIn();
  return renderWithProviders(
    <>
      <SignInAgain />
      <LazyDistributions plugin='ansible' repositoryHref={REPOSITORY} />
    </>,
  );
}

afterEach(() => {
  resetSessionEvents();
});

describe('the distributions of a repository after the session ended', () => {
  it('keeps the spinner and shows no failure marker for a 401', async () => {
    server.use(refused);
    renderAfterSignIn();
    await signedIn();
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByText('---')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('reads again after the same user signs in again and names the distributions', async () => {
    server.use(refused);
    const { user } = renderAfterSignIn();
    await signedIn();
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
    server.use(listOf(DISTRIBUTIONS, [distribution('alpha')]).handler);

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));

    expect(await screen.findByText(/alpha/)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('replaces the names it shows with the fresh ones', async () => {
    server.use(listOf(DISTRIBUTIONS, [distribution('alpha')]).handler);
    const { user } = renderAfterSignIn();
    await screen.findByText(/alpha/);
    await signedIn();
    server.use(listOf(DISTRIBUTIONS, [distribution('beta')]).handler);

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));

    expect(await screen.findByText(/beta/)).toBeInTheDocument();
    expect(screen.queryByText(/alpha/)).toBeNull();
  });
});
