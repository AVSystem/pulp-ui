import { describe, expect, it } from 'vitest';
import { URL_BUDGET } from 'src/entities/batch';
import {
  artifactDistribution,
  coreDistributionListHandler,
  coreDistributionRow,
  distributionListHandler,
  listOf,
  pluginDistribution,
} from 'src/test-utils/pulp';
import { server } from 'src/test-utils/server';
import {
  DISTRIBUTION_TYPES,
  distributionPage,
  distributionTypeName,
  enrichmentChunks,
  pluginOfDistribution,
  readEnrichment,
} from './page';

const fieldsOf = (query: URLSearchParams) =>
  query.getAll('fields').flatMap((value) => value.split(','));

describe('Unit: the type of a distribution row', { tags: ['unit'] }, () => {
  it('names the pulp_type, PRN model and endpoint of every plugin that has distributions', () => {
    expect(
      Object.fromEntries(
        Object.entries(DISTRIBUTION_TYPES).map(([plugin, type]) => [
          plugin,
          [type.pulpType, type.model, type.endpoint],
        ]),
      ),
    ).toEqual({
      file: ['file.file', 'file.filedistribution', 'file/file'],
      deb: ['deb.apt-distribution', 'deb.aptdistribution', 'deb/apt'],
      rpm: ['rpm.rpm', 'rpm.rpmdistribution', 'rpm/rpm'],
      python: ['python.python', 'python.pythondistribution', 'python/pypi'],
      maven: ['maven.maven', 'maven.mavendistribution', 'maven/maven'],
      npm: ['npm.npm', 'npm.npmdistribution', 'npm/npm'],
      ansible: [
        'ansible.ansible',
        'ansible.ansibledistribution',
        'ansible/ansible',
      ],
      container: [
        'container.container',
        'container.containerdistribution',
        'container/container',
      ],
    });
  });

  it.each(Object.keys(DISTRIBUTION_TYPES))(
    'reads the %s plugin from the PRN of a row',
    (plugin) => {
      const row = pluginDistribution(plugin as keyof typeof DISTRIBUTION_TYPES);

      expect(pluginOfDistribution(row)).toBe(plugin);
    },
  );

  it('reads the plugin from the address when the row carries no PRN', () => {
    const row = Object.fromEntries(
      Object.entries(pluginDistribution('python')).filter(
        ([key]) => key !== 'prn',
      ),
    ) as { pulp_href: string };

    expect(pluginOfDistribution(row)).toBe('python');
  });

  it('trusts the PRN before the address', () => {
    const row = {
      ...pluginDistribution('file'),
      pulp_href: pluginDistribution('rpm').pulp_href,
    };

    expect(pluginOfDistribution(row)).toBe('file');
  });

  it('knows no plugin for an artifact distribution or for a model it has not heard of', () => {
    expect(pluginOfDistribution(artifactDistribution())).toBeNull();
    expect(
      pluginOfDistribution({
        pulp_href: '/pulp/api/v3/distributions/zzz/zzz/1/',
        prn: 'prn:zzz.zzzdistribution:1',
      }),
    ).toBeNull();
    expect(pluginOfDistribution({ pulp_href: '/elsewhere/' })).toBeNull();
  });

  it('names the type of a row by the model of its PRN, or its address', () => {
    expect(distributionTypeName(artifactDistribution())).toBe(
      'core.artifactdistribution',
    );
    expect(
      distributionTypeName({
        pulp_href: '/pulp/api/v3/distributions/zzz/zzz/1/',
      }),
    ).toBe('zzz/zzz');
    expect(distributionTypeName({ pulp_href: '/elsewhere/' })).toBe('unknown');
  });
});

describe(
  'Integration: the page of distributions',
  { tags: ['integration'] },
  () => {
    const lab = () => {
      const rows = [
        pluginDistribution('file', { name: 'files', base_path: 'files' }),
        pluginDistribution('python', { name: 'pypi', base_path: 'pypi' }),
        pluginDistribution('maven', { name: 'jars', base_path: 'jars' }),
        artifactDistribution(),
      ].map(coreDistributionRow);
      const served = coreDistributionListHandler(rows);
      server.use(served.handler);
      return { rows, served };
    };

    it('sends one request with the offset, limit, ordering, the types of the plugins asked for and the fields of the list', async () => {
      const { served } = lab();

      await distributionPage({
        plugins: ['file', 'python'],
        page: 3,
        page_size: 20,
        sort: '-base_path',
      });

      expect(served.queries).toHaveLength(1);
      const query = served.queries[0] as URLSearchParams;
      expect(query.get('offset')).toBe('40');
      expect(query.get('limit')).toBe('20');
      expect(query.get('ordering')).toBe('-base_path');
      expect(query.get('pulp_type__in')).toBe('file.file,python.python');
      expect(fieldsOf(query)).toEqual(
        expect.arrayContaining([
          'pulp_href',
          'prn',
          'name',
          'base_path',
          'base_url',
        ]),
      );
    });

    it('orders by name from the first page when nothing else is asked', async () => {
      const { served } = lab();

      await distributionPage({ plugins: ['file'] });

      const query = served.queries[0] as URLSearchParams;
      expect(query.get('offset')).toBe('0');
      expect(query.get('limit')).toBe('50');
      expect(query.get('ordering')).toBe('name');
    });

    it('gives every row the plugin its PRN names', async () => {
      lab();

      const page = await distributionPage({
        plugins: ['file', 'python', 'maven'],
      });

      expect(page.count).toBe(3);
      expect(page.results.map(({ name, plugin }) => [name, plugin])).toEqual([
        ['files', 'file'],
        ['jars', 'maven'],
        ['pypi', 'python'],
      ]);
    });

    it('never asks for the artifact distributions, which no plugin screen shows', async () => {
      const { served } = lab();

      const page = await distributionPage({
        plugins: [
          'file',
          'deb',
          'rpm',
          'python',
          'maven',
          'npm',
          'ansible',
          'container',
        ],
      });

      const types = (served.queries[0] as URLSearchParams)
        .get('pulp_type__in')
        ?.split(',');
      expect(types).not.toContain('core.artifact');
      expect(types).not.toContain('core.openpgp');
      expect(page.results.map(({ name }) => name)).not.toContain(
        artifactDistribution().name,
      );
    });

    it('drops an artifact row a server answered anyway, and keeps a row of an unknown type read-only under its type name', async () => {
      const strange = {
        ...pluginDistribution('file', {
          name: 'strange',
          base_path: 'strange',
        }),
        prn: 'prn:zzz.zzzdistribution:1',
      };
      const rows = [
        artifactDistribution(),
        strange,
        pluginDistribution('file', { name: 'files', base_path: 'files' }),
      ].map(coreDistributionRow);
      // a server that ignores the type filter answers every row
      server.use(listOf('/pulp/api/v3/distributions/', rows).handler);

      const page = await distributionPage({ plugins: ['file'] });

      expect(page.results.map(({ name }) => name)).toEqual([
        'strange',
        'files',
      ]);
      const odd = page.results.find(({ name }) => name === 'strange');
      expect(odd?.plugin).toBeNull();
      expect(odd?.typeName).toBe('zzz.zzzdistribution');
    });

    it('sends nothing when no plugin is installed', async () => {
      const { served } = lab();

      const page = await distributionPage({ plugins: [] });

      expect(page).toEqual({
        count: 0,
        next: null,
        previous: null,
        results: [],
      });
      expect(served.queries).toHaveLength(0);
    });
  },
);

describe(
  'Integration: the enrichment of a page',
  { tags: ['integration'] },
  () => {
    it('groups the rows by plugin and leaves out a row no plugin owns', () => {
      const rows = [
        pluginDistribution('file'),
        pluginDistribution('python'),
        pluginDistribution('file'),
        artifactDistribution(),
      ].map((row) => ({ ...coreDistributionRow(row), ...describePlugin(row) }));

      const chunks = enrichmentChunks(rows);

      expect(chunks.map(({ plugin }) => plugin)).toEqual(['file', 'python']);
      expect(chunks[0]?.hrefs).toEqual([
        rows[0]?.pulp_href,
        rows[2]?.pulp_href,
      ]);
      expect(chunks.flatMap(({ hrefs }) => hrefs)).not.toContain(
        rows[3]?.pulp_href,
      );
    });

    it('splits the rows of one plugin so that no request is longer than the URL budget, keeping every row once', () => {
      const rows = Array.from({ length: 300 }, () =>
        pluginDistribution('file'),
      ).map((row) => ({ ...coreDistributionRow(row), ...describePlugin(row) }));

      const chunks = enrichmentChunks(rows);

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.flatMap(({ hrefs }) => hrefs)).toEqual(
        rows.map(({ pulp_href }) => pulp_href),
      );
      for (const { hrefs } of chunks) {
        const url = `/pulp/api/v3/distributions/file/file/?pulp_href__in=${encodeURIComponent(hrefs.join(','))}`;
        expect(url.length).toBeLessThan(URL_BUDGET + 600);
      }
    });

    it('reads a chunk with one request for the plugin and gives each row the client URL of its plugin', async () => {
      const python = pluginDistribution('python', {
        name: 'pypi',
        base_path: 'pypi',
        base_url: 'https://pulp.example/pypi/pypi/',
      });
      const other = pluginDistribution('python', {
        name: 'other',
        base_path: 'other',
      });
      const served = distributionListHandler('python', [python, other]);
      server.use(served.handler);

      const urls = await readEnrichment({
        plugin: 'python',
        hrefs: [python.pulp_href],
      });

      expect(served.queries).toHaveLength(1);
      expect(served.queries[0]?.get('pulp_href__in')).toBe(python.pulp_href);
      expect(urls).toEqual([
        [python.pulp_href, 'https://pulp.example/pypi/pypi/'],
      ]);
    });

    it('takes the collection source address of an ansible row and never the content path', async () => {
      const ansible = pluginDistribution('ansible', {
        name: 'galaxy',
        base_path: 'galaxy',
      });
      const served = distributionListHandler('ansible', [ansible]);
      server.use(served.handler);

      const urls = await readEnrichment({
        plugin: 'ansible',
        hrefs: [ansible.pulp_href],
      });

      expect(fieldsOf(served.queries[0] as URLSearchParams)).toContain(
        'client_url',
      );
      expect(urls).toEqual([
        [ansible.pulp_href, 'https://pulp.example/pulp_ansible/galaxy/galaxy/'],
      ]);
    });

    it('reads nothing for no addresses', async () => {
      const served = distributionListHandler('file', []);
      server.use(served.handler);

      expect(await readEnrichment({ plugin: 'file', hrefs: [] })).toEqual([]);
      expect(served.queries).toHaveLength(0);
    });
  },
);

// The plugin and type name a page gives a row, as the page does.
function describePlugin(row: ReturnType<typeof pluginDistribution>) {
  return {
    plugin: pluginOfDistribution(row),
    typeName: distributionTypeName(row),
  };
}
