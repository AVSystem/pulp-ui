import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { Paths } from 'src/paths';
import { listOf } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import PythonPackageList from './package-list';

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
});

const packages = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    name: `zz-pkg-${i}`,
    version: `1.0.${i}`,
    packagetype: 'sdist',
    filename: `zz-pkg-${i}-1.0.${i}.tar.gz`,
    pulp_href: `${API}/content/python/packages/00000000-0000-4000-8000-${String(i).padStart(12, '0')}/`,
  }));

function renderList() {
  return renderWithProviders(
    <AppContextProvider>
      <Routes>
        <Route
          path={Paths.python.package.list}
          element={<PythonPackageList />}
        />
      </Routes>
    </AppContextProvider>,
    { route: '/python/packages' },
  );
}

describe('Python package list', () => {
  it.each([0, 1, 10])(
    'sends no repository request when it shows %i packages',
    async (count) => {
      server.use(
        listOf(`${API}/content/python/packages/`, packages(count)).handler,
        // any repository lookup would be answered, so a request is visible in
        // the recorded paths rather than as an unhandled-request error
        http.get(`*${API}/repositories/python/python/`, () =>
          HttpResponse.json({
            count: 0,
            next: null,
            previous: null,
            results: [],
          }),
        ),
      );
      renderList();

      if (count === 0) {
        expect(await screen.findByText('No packages yet')).toBeInTheDocument();
      } else {
        expect(await screen.findByText('zz-pkg-0')).toBeInTheDocument();
        expect(
          screen.getByText(`zz-pkg-${count - 1}-1.0.${count - 1}.tar.gz`),
        ).toBeInTheDocument();
      }

      expect(
        paths.filter((p) => p.includes('/repositories/python/python/')),
      ).toStrictEqual([]);
      expect(screen.queryByText('Repository')).toBeNull();
    },
  );
});
