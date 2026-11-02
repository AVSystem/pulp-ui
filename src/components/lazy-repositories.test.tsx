import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listOf, repository } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { LazyRepositories } from './lazy-repositories';

const API = '/pulp/api/v3';
const REMOTE = `${API}/remotes/file/file/00000000-0000-4000-8000-0000000000aa/`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('repositories that use a remote', () => {
  it('names every repository, comma separated, and gives each a stable key', async () => {
    // React reports a missing key once per component, so the one test that
    // renders rows is also the one that checks for it.
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const rows = ['alpha', 'beta', 'gamma'].map((name) => repository({ name }));
    server.use(listOf(`${API}/repositories/file/file/`, rows).handler);

    renderWithProviders(
      <LazyRepositories plugin='file' remote_href={REMOTE} />,
    );

    expect(await screen.findByText(/alpha/)).toBeInTheDocument();
    expect(screen.getByText(/beta/)).toBeInTheDocument();
    expect(screen.getByText(/gamma/)).toBeInTheDocument();
    const keyWarnings = consoleError.mock.calls.filter((args) =>
      args.some((arg) => /unique "key" prop/.test(String(arg))),
    );
    expect(keyWarnings).toHaveLength(0);
  });

  it('shows a failure marker with the reason when the request gets no answer', async () => {
    server.use(
      http.get(`*${API}/repositories/file/file/`, () => HttpResponse.error()),
    );

    const { user } = renderWithProviders(
      <LazyRepositories plugin='file' remote_href={REMOTE} />,
    );

    const marker = await screen.findByRole('button');
    await user.hover(marker);

    expect(
      await screen.findByText(/Failed to load repositories: Network Error/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('keeps the status line in the failure reason when the server answers an error', async () => {
    server.use(
      http.get(`*${API}/repositories/file/file/`, () =>
        HttpResponse.json({}, { status: 500, statusText: 'Broken' }),
      ),
    );

    const { user } = renderWithProviders(
      <LazyRepositories plugin='file' remote_href={REMOTE} />,
    );

    await user.hover(await screen.findByRole('button'));

    expect(
      await screen.findByText(/Failed to load repositories: Error 500/),
    ).toBeInTheDocument();
  });
});
