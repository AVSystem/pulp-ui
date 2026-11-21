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
import { rpmDistribution } from './distribution';
import { rpmPublication } from './publication';
import { rpmRemote } from './remote';
import { rpmRepository } from './repository';

const API = '/pulp/api/v3';
const TASK = '/pulp/api/v3/tasks/00000000-0000-4000-8000-00000000e001/';

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

describe('Unit: the rpm entities', { tags: ['unit'] }, () => {
  describe('the repository', () => {
    it('names the plugin and the object it keys its reads by', () => {
      expect(rpmRepository.app).toBe('rpm');
      expect(rpmRepository.object).toBe('repository');
    });

    it('lists and finds a repository by name at the rpm repositories address', async () => {
      const row = pluginRepository('rpm', { name: 'baseos' });
      const lab = pluginListHandler('rpm', 'repository', [row]);
      server.use(lab.handler);

      const found = await rpmRepository.byName('baseos');

      expect(found).toMatchObject({ name: 'baseos' });
      expect(lab.path).toBe(`${API}/repositories/rpm/rpm/`);
      expect(Object.fromEntries(lab.queries[0])).toEqual({
        name: 'baseos',
        limit: '1',
      });
    });

    it('keeps the fields only rpm has, as they came', async () => {
      const row = pluginRepository('rpm', {
        name: 'a',
        autopublish: true,
        retain_package_versions: 3,
      });
      server.use(pluginListHandler('rpm', 'repository', [row]).handler);

      const answer = await rpmRepository.list({});

      expect(answer.results[0]).toMatchObject({
        autopublish: true,
        retain_package_versions: 3,
      });
    });

    it('creates with one POST to the rpm address and updates with one PATCH of the changed fields', async () => {
      const row = pluginRepository('rpm', { name: 'new' });
      const calls = recorder();
      server.use(
        http.post(`*${API}/repositories/rpm/rpm/`, async ({ request }) => {
          await calls.record(request);
          return HttpResponse.json(row, { status: 201 });
        }),
        http.patch(`*${row.pulp_href}`, async ({ request }) => {
          await calls.record(request);
          return HttpResponse.json({ task: TASK }, { status: 202 });
        }),
      );

      await rpmRepository.create({
        name: 'new',
        autopublish: false,
        retain_package_versions: 0,
      });
      const result = await rpmRepository.update(row.pulp_href, {
        retain_package_versions: 0,
      });

      expect(result).toEqual({ kind: 'task', task: TASK });
      expect(calls.seen.map(({ method, body }) => [method, body])).toEqual([
        ['POST', { name: 'new', autopublish: false, retain_package_versions: 0 }],
        ['PATCH', { retain_package_versions: 0 }],
      ]);
      expect(calls.seen[0]?.pathname).toBe(`${API}/repositories/rpm/rpm/`);
    });

    it('starts a sync with the policy, a modify and a label change at the addresses of the repository', async () => {
      const row = pluginRepository('rpm');
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
        await rpmRepository.sync?.(row.pulp_href, {
          sync_policy: 'mirror_content_only',
          optimize: true,
        }),
      ).toBe(TASK);
      expect(
        await rpmRepository.modify?.(row.pulp_href, {
          base_version: `${row.pulp_href}versions/1/`,
        }),
      ).toBe(TASK);
      await rpmRepository.setLabel(row.pulp_href, {
        key: 'team',
        value: 'ops',
      });

      expect(calls.seen.map(({ pathname }) => pathname)).toEqual([
        `${row.pulp_href}sync/`,
        `${row.pulp_href}modify/`,
        `${row.pulp_href}set_label/`,
      ]);
      expect(calls.seen[0]?.body).toEqual({
        sync_policy: 'mirror_content_only',
        optimize: true,
      });
    });

    it('reads the versions of a repository from its own versions address', async () => {
      const row = pluginRepository('rpm');
      const versions = listOf(`${row.pulp_href}versions/`, [
        {
          pulp_href: `${row.pulp_href}versions/1/`,
          number: 1,
          pulp_created: '2000-01-01T00:00:00.000000Z',
        },
      ]);
      server.use(versions.handler);

      const answer = await rpmRepository.versions(row.pulp_href, {});

      expect(answer.results.map(({ number }) => number)).toEqual([1]);
    });
  });

  describe('the remote', () => {
    it('names the plugin and the object it keys its reads by', () => {
      expect(rpmRemote.app).toBe('rpm');
      expect(rpmRemote.object).toBe('remote');
    });

    it('lists and finds a remote by name at the rpm remotes address', async () => {
      const row = pluginRemote('rpm', {
        name: 'upstream',
        url: 'https://rpm.example/baseos/',
        policy: 'on_demand',
      });
      const lab = pluginListHandler('rpm', 'remote', [row]);
      server.use(lab.handler);

      const found = await rpmRemote.byName('upstream');

      expect(lab.path).toBe(`${API}/remotes/rpm/rpm/`);
      expect(found).toMatchObject({
        url: 'https://rpm.example/baseos/',
        policy: 'on_demand',
      });
    });

    it('creates with one POST to the rpm remotes address and sets a label there', async () => {
      const row = pluginRemote('rpm', { name: 'r' });
      const calls = recorder();
      server.use(
        http.post(`*${API}/remotes/rpm/rpm/`, async ({ request }) => {
          await calls.record(request);
          return HttpResponse.json(row, { status: 201 });
        }),
        http.post(`*${row.pulp_href}set_label/`, async ({ request }) => {
          await calls.record(request);
          return HttpResponse.json({ key: 'k', value: 'v' });
        }),
      );

      await rpmRemote.create({
        name: 'r',
        url: 'https://rpm.example/baseos/',
      });
      await rpmRemote.setLabel(row.pulp_href, { key: 'k', value: 'v' });

      expect(
        calls.seen.map(({ method, pathname }) => [method, pathname]),
      ).toEqual([
        ['POST', `${API}/remotes/rpm/rpm/`],
        ['POST', `${row.pulp_href}set_label/`],
      ]);
      expect(calls.seen[0]?.body).toEqual({
        name: 'r',
        url: 'https://rpm.example/baseos/',
      });
    });
  });

  describe('the distribution and the publication', () => {
    it('read the rpm distributions and publications', async () => {
      const distributions = listOf(`${API}/distributions/rpm/rpm/`, [
        pluginDistribution('rpm', { name: 'baseos', base_path: 'rpm/x' }),
      ]);
      const publications = listOf(`${API}/publications/rpm/rpm/`, [
        pluginPublication('rpm'),
      ]);
      server.use(distributions.handler, publications.handler);

      const served = await rpmDistribution.list({});
      const published = await rpmPublication.list({});

      expect(served.results[0]).toMatchObject({ base_path: 'rpm/x' });
      expect(published.results).toHaveLength(1);
      expect(distributions.queries).toHaveLength(1);
      expect(publications.queries).toHaveLength(1);
    });
  });
});
