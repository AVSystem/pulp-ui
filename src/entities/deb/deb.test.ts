import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import {
  listOf,
  pluginDistribution,
  pluginListHandler,
  pluginPublication,
  pluginRemote,
  pluginRepository,
} from 'src/test-utils/pulp';
import { server } from 'src/test-utils/server';
import { debDistribution } from './distribution';
import { debPublication } from './publication';
import { debRemote } from './remote';
import { debRepository } from './repository';

const API = '/pulp/api/v3';
const TASK = '/pulp/api/v3/tasks/00000000-0000-4000-8000-00000000d001/';

// The body and the address of every request a handler answers.
function recorder() {
  const seen: { method: string; pathname: string; body: unknown }[] = [];
  return {
    seen,
    async record(request: Request) {
      const text = await request.clone().text();
      seen.push({
        method: request.method,
        pathname: new URL(request.url).pathname,
        body: text ? JSON.parse(text) : undefined,
      });
    },
  };
}

describe('Unit: the deb entities', { tags: ['unit'] }, () => {
  describe('the repository', () => {
    it('names the plugin and the object it keys its reads by', () => {
      expect(debRepository.app).toBe('deb');
      expect(debRepository.object).toBe('repository');
    });

    it('lists and finds a repository by name at the apt repositories address', async () => {
      const row = pluginRepository('deb', { name: 'bookworm-mirror' });
      const lab = pluginListHandler('deb', 'repository', [row]);
      server.use(lab.handler);

      const found = await debRepository.byName('bookworm-mirror');

      expect(found).toMatchObject({ name: 'bookworm-mirror' });
      expect(lab.path).toBe(`${API}/repositories/deb/apt/`);
      expect(Object.fromEntries(lab.queries[0])).toEqual({
        name: 'bookworm-mirror',
        limit: '1',
      });
    });

    it('keeps the fields only deb has, as they came', async () => {
      const row = pluginRepository('deb', {
        name: 'a',
        autopublish: true,
        publish_upstream_release_fields: false,
      });
      server.use(pluginListHandler('deb', 'repository', [row]).handler);

      const answer = await debRepository.list({});

      expect(answer.results[0]).toMatchObject({
        autopublish: true,
        publish_upstream_release_fields: false,
      });
    });

    it('creates with one POST to the apt address and updates with one PATCH of the changed fields', async () => {
      const row = pluginRepository('deb', { name: 'new' });
      const calls = recorder();
      server.use(
        http.post(`*${API}/repositories/deb/apt/`, async ({ request }) => {
          await calls.record(request);
          return HttpResponse.json(row, { status: 201 });
        }),
        http.patch(`*${row.pulp_href}`, async ({ request }) => {
          await calls.record(request);
          return HttpResponse.json({ task: TASK }, { status: 202 });
        }),
      );

      await debRepository.create({
        name: 'new',
        autopublish: false,
        publish_upstream_release_fields: true,
      });
      const result = await debRepository.update(row.pulp_href, {
        publish_upstream_release_fields: false,
      });

      expect(result).toEqual({ kind: 'task', task: TASK });
      expect(calls.seen.map(({ method, body }) => [method, body])).toEqual([
        [
          'POST',
          {
            name: 'new',
            autopublish: false,
            publish_upstream_release_fields: true,
          },
        ],
        ['PATCH', { publish_upstream_release_fields: false }],
      ]);
      expect(calls.seen[0]?.pathname).toBe(`${API}/repositories/deb/apt/`);
    });

    it('starts a sync, a modify and a label change at the addresses of the repository', async () => {
      const row = pluginRepository('deb');
      const calls = recorder();
      server.use(
        http.post(`*${row.pulp_href}sync/`, async ({ request }) => {
          await calls.record(request);
          return HttpResponse.json({ task: TASK }, { status: 202 });
        }),
        http.post(`*${row.pulp_href}modify/`, async ({ request }) => {
          await calls.record(request);
          return HttpResponse.json({ task: TASK }, { status: 202 });
        }),
        http.post(`*${row.pulp_href}set_label/`, async ({ request }) => {
          await calls.record(request);
          return HttpResponse.json({ key: 'team', value: 'ops' });
        }),
      );

      expect(
        await debRepository.sync?.(row.pulp_href, {
          mirror: false,
          optimize: true,
        }),
      ).toBe(TASK);
      expect(
        await debRepository.modify?.(row.pulp_href, {
          base_version: `${row.pulp_href}versions/1/`,
        }),
      ).toBe(TASK);
      await debRepository.setLabel(row.pulp_href, {
        key: 'team',
        value: 'ops',
      });

      expect(calls.seen.map(({ pathname }) => pathname)).toEqual([
        `${row.pulp_href}sync/`,
        `${row.pulp_href}modify/`,
        `${row.pulp_href}set_label/`,
      ]);
      expect(calls.seen[0]?.body).toEqual({ mirror: false, optimize: true });
    });

    it('reads the versions of a repository from its own versions address', async () => {
      const row = pluginRepository('deb');
      const versions = listOf(`${row.pulp_href}versions/`, [
        {
          pulp_href: `${row.pulp_href}versions/1/`,
          number: 1,
          pulp_created: '2000-01-01T00:00:00.000000Z',
        },
      ]);
      server.use(versions.handler);

      const answer = await debRepository.versions(row.pulp_href, {});

      expect(answer.results.map(({ number }) => number)).toEqual([1]);
    });
  });

  describe('the remote', () => {
    it('names the plugin and the object it keys its reads by', () => {
      expect(debRemote.app).toBe('deb');
      expect(debRemote.object).toBe('remote');
    });

    it('lists and finds a remote by name at the apt remotes address, keeping the apt fields', async () => {
      const row = pluginRemote('deb', {
        name: 'upstream',
        distributions: 'bookworm bookworm-updates',
        components: 'main',
        architectures: 'amd64',
        gpgkey: '-----BEGIN PGP PUBLIC KEY BLOCK-----',
        sync_sources: false,
        sync_udebs: true,
        sync_installer: false,
      });
      const lab = pluginListHandler('deb', 'remote', [row]);
      server.use(lab.handler);

      const found = await debRemote.byName('upstream');

      expect(lab.path).toBe(`${API}/remotes/deb/apt/`);
      expect(found).toMatchObject({
        distributions: 'bookworm bookworm-updates',
        components: 'main',
        architectures: 'amd64',
        sync_udebs: true,
      });
    });

    it('creates with one POST to the apt remotes address and sets a label there', async () => {
      const row = pluginRemote('deb', { name: 'r' });
      const calls = recorder();
      server.use(
        http.post(`*${API}/remotes/deb/apt/`, async ({ request }) => {
          await calls.record(request);
          return HttpResponse.json(row, { status: 201 });
        }),
        http.post(`*${row.pulp_href}set_label/`, async ({ request }) => {
          await calls.record(request);
          return HttpResponse.json({ key: 'k', value: 'v' });
        }),
      );

      await debRemote.create({
        name: 'r',
        url: 'https://deb.example/debian/',
        distributions: 'bookworm',
      });
      await debRemote.setLabel(row.pulp_href, { key: 'k', value: 'v' });

      expect(
        calls.seen.map(({ method, pathname }) => [method, pathname]),
      ).toEqual([
        ['POST', `${API}/remotes/deb/apt/`],
        ['POST', `${row.pulp_href}set_label/`],
      ]);
      expect(calls.seen[0]?.body).toEqual({
        name: 'r',
        url: 'https://deb.example/debian/',
        distributions: 'bookworm',
      });
    });
  });

  describe('the distribution and the publication', () => {
    it('read the apt distributions and publications', async () => {
      const distributions = listOf(`${API}/distributions/deb/apt/`, [
        pluginDistribution('deb', { name: 'bookworm', base_path: 'deb/x' }),
      ]);
      const publications = listOf(`${API}/publications/deb/apt/`, [
        pluginPublication('deb'),
      ]);
      server.use(distributions.handler, publications.handler);

      const served = await debDistribution.list({});
      const published = await debPublication.list({});

      expect(served.results[0]).toMatchObject({ base_path: 'deb/x' });
      expect(published.results).toHaveLength(1);
      expect(distributions.queries).toHaveLength(1);
      expect(publications.queries).toHaveLength(1);
    });
  });
});
