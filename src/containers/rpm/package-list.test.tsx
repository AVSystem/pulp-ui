import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { Paths } from 'src/paths';
import { listOf } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import RPMPackageList from './package-list';

const API = '/pulp/api/v3';

let paths: string[];

// Records the path of every request the page makes.
beforeEach(() => {
  paths = [];
  server.events.on('request:start', ({ request }) => {
    paths.push(new URL(request.url).pathname);
  });
});

afterEach(() => {
  server.events.removeAllListeners();
  vi.restoreAllMocks();
});

const hrefOf = (i: number) =>
  `${API}/content/rpm/packages/00000000-0000-4000-8000-${String(i).padStart(12, '0')}/`;

const packages = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    name: `zz-pkg-${i}`,
    version: `1.0.${i}`,
    arch: 'x86_64',
    pulp_href: hrefOf(i),
  }));

// Any repository lookup would be answered, so a request is visible in the
// recorded paths rather than as an unhandled-request error.
const answerRepositoryLookups = () =>
  http.get(`*${API}/repositories/rpm/rpm/`, () =>
    HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
  );

function renderList() {
  return renderWithProviders(
    <AppContextProvider>
      <Routes>
        <Route path={Paths.rpm.package.list} element={<RPMPackageList />} />
      </Routes>
    </AppContextProvider>,
    { route: '/rpm/rpms' },
  );
}

describe('RPM package list', () => {
  it.each([0, 1, 10])(
    'sends no repository request when it shows %i packages',
    async (count) => {
      server.use(
        listOf(`${API}/content/rpm/packages/`, packages(count)).handler,
        answerRepositoryLookups(),
      );
      renderList();

      if (count === 0) {
        expect(await screen.findByText('No packages yet')).toBeInTheDocument();
      } else {
        expect(await screen.findByText('zz-pkg-0')).toBeInTheDocument();
        expect(screen.getByText(`zz-pkg-${count - 1}`)).toBeInTheDocument();
      }

      expect(
        paths.filter((p) => p.includes('/repositories/rpm/rpm/')),
      ).toStrictEqual([]);
      expect(screen.queryByText('Repository')).toBeNull();
    },
  );

  it('lists packages with the same name and another version or architecture as separate rows in the order the server returned them', async () => {
    const errors = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const rows = [
      { name: 'bash', version: '5.2', arch: 'x86_64', pulp_href: hrefOf(1) },
      { name: 'bash', version: '5.2', arch: 'aarch64', pulp_href: hrefOf(2) },
      { name: 'bash', version: '5.1', arch: 'x86_64', pulp_href: hrefOf(3) },
    ];
    server.use(
      listOf(`${API}/content/rpm/packages/`, rows).handler,
      answerRepositoryLookups(),
    );
    renderList();

    await screen.findAllByText('bash');
    const body = screen.getAllByRole('rowgroup').at(-1) as HTMLElement;
    const shown = within(body)
      .getAllByRole('row')
      .map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((cell) => cell.textContent)
          .slice(0, 3),
      );

    expect(shown).toStrictEqual([
      ['bash', '5.2', 'x86_64'],
      ['bash', '5.2', 'aarch64'],
      ['bash', '5.1', 'x86_64'],
    ]);
    expect(
      errors.mock.calls.filter((call) => String(call[0]).includes('key')),
    ).toStrictEqual([]);
  });
});
