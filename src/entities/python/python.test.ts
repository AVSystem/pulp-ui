import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import {
  listOf,
  pluginListHandler,
  pluginRemote,
  pluginRepository,
  pythonDistribution,
} from 'src/test-utils/pulp';
import { server } from 'src/test-utils/server';
import { pythonDistribution as pythonDistributionEntity } from './distribution';
import { pythonRemote } from './remote';
import { pythonRepository } from './repository';

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

describe('Unit: the python entities', { tags: ['unit'] }, () => {
  describe('the repository', () => {
    it('names the plugin and the object it keys its reads by', () => {
      expect(pythonRepository.app).toBe('python');
      expect(pythonRepository.object).toBe('repository');
    });

    it('lists and finds a repository by name at the python repositories address', async () => {
      const row = pluginRepository('python', { name: 'simple' });
      const lab = pluginListHandler('python', 'repository', [row]);
      server.use(lab.handler);

      const found = await pythonRepository.byName('simple');

      expect(found).toMatchObject({ name: 'simple' });
      expect(lab.path).toBe(`${API}/repositories/python/python/`);
    });

    it('keeps the fields only python has, as they came', async () => {
      const row = pluginRepository('python', {
        name: 'a',
        allow_package_substitution: false,
        error_on_reject: false,
      });
      server.use(pluginListHandler('python', 'repository', [row]).handler);

      const answer = await pythonRepository.list({});

      expect(answer.results[0]).toMatchObject({
        allow_package_substitution: false,
        error_on_reject: false,
      });
    });

    it('creates with one POST to the python address and updates with one PATCH of the changed fields', async () => {
      const row = pluginRepository('python', { name: 'new' });
      const calls = recorder();
      server.use(
        http.post(
          `*${API}/repositories/python/python/`,
          async ({ request }) => {
            await calls.record(request);
            return HttpResponse.json(row, { status: 201 });
          },
        ),
        http.patch(`*${row.pulp_href}`, async ({ request }) => {
          await calls.record(request);
          return HttpResponse.json({ task: TASK }, { status: 202 });
        }),
      );

      await pythonRepository.create({
        name: 'new',
        allow_package_substitution: true,
        error_on_reject: true,
      });
      const result = await pythonRepository.update(row.pulp_href, {
        error_on_reject: false,
      });

      expect(result).toEqual({ kind: 'task', task: TASK });
      expect(calls.seen.map(({ method, body }) => [method, body])).toEqual([
        [
          'POST',
          {
            name: 'new',
            allow_package_substitution: true,
            error_on_reject: true,
          },
        ],
        ['PATCH', { error_on_reject: false }],
      ]);
    });

    it('starts a sync with the mirror choice and no optimize, and a modify at the addresses of the repository', async () => {
      const row = pluginRepository('python');
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
      );

      expect(
        await pythonRepository.sync?.(row.pulp_href, {
          remote: `${API}/remotes/python/python/1/`,
          mirror: false,
        }),
      ).toBe(TASK);
      expect(
        await pythonRepository.modify?.(row.pulp_href, {
          base_version: `${row.pulp_href}versions/1/`,
        }),
      ).toBe(TASK);

      expect(calls.seen.map(({ pathname }) => pathname)).toEqual([
        `${row.pulp_href}sync/`,
        `${row.pulp_href}modify/`,
      ]);
      expect(calls.seen[0]?.body).toEqual({
        remote: `${API}/remotes/python/python/1/`,
        mirror: false,
      });
    });

    it('reads the versions of a repository from its own versions address', async () => {
      const row = pluginRepository('python');
      const versions = listOf(`${row.pulp_href}versions/`, [
        {
          pulp_href: `${row.pulp_href}versions/1/`,
          number: 1,
          pulp_created: '2000-01-01T00:00:00.000000Z',
        },
      ]);
      server.use(versions.handler);

      const answer = await pythonRepository.versions(row.pulp_href, {});

      expect(answer.results.map(({ number }) => number)).toEqual([1]);
    });
  });

  describe('the remote', () => {
    it('names the plugin and the object it keys its reads by', () => {
      expect(pythonRemote.app).toBe('python');
      expect(pythonRemote.object).toBe('remote');
    });

    it('lists and finds a remote by name, keeping the fields only python has', async () => {
      const row = pluginRemote('python', {
        name: 'pypi',
        url: 'https://pypi.example/',
        policy: 'on_demand',
        includes: ['django>=4.2'],
        package_types: ['sdist'],
        vulnerabilities: true,
      });
      const lab = pluginListHandler('python', 'remote', [row]);
      server.use(lab.handler);

      const found = await pythonRemote.byName('pypi');

      expect(lab.path).toBe(`${API}/remotes/python/python/`);
      expect(found).toMatchObject({
        policy: 'on_demand',
        includes: ['django>=4.2'],
        package_types: ['sdist'],
        vulnerabilities: true,
      });
    });

    it('creates with one POST to the python remotes address and patches the fields as given', async () => {
      const row = pluginRemote('python', { name: 'r' });
      const calls = recorder();
      server.use(
        http.post(`*${API}/remotes/python/python/`, async ({ request }) => {
          await calls.record(request);
          return HttpResponse.json(row, { status: 201 });
        }),
        http.patch(`*${row.pulp_href}`, async ({ request }) => {
          await calls.record(request);
          return HttpResponse.json({ task: TASK }, { status: 202 });
        }),
      );

      await pythonRemote.create({
        name: 'r',
        url: 'https://pypi.example/',
        includes: ['django'],
        vulnerabilities: true,
      });
      await pythonRemote.update(row.pulp_href, { prereleases: true });

      expect(calls.seen.map(({ method, body }) => [method, body])).toEqual([
        [
          'POST',
          {
            name: 'r',
            url: 'https://pypi.example/',
            includes: ['django'],
            vulnerabilities: true,
          },
        ],
        ['PATCH', { prereleases: true }],
      ]);
    });
  });

  describe('the distribution', () => {
    it('reads the python distributions at the pypi address, with the remote and the upload permission it carries', async () => {
      const row = pythonDistribution({
        name: 'simple',
        base_path: 'simple',
        remote: `${API}/remotes/python/python/1/`,
        allow_uploads: false,
      });
      const lab = listOf(`${API}/distributions/python/pypi/`, [row]);
      server.use(lab.handler);

      const served = await pythonDistributionEntity.list({});

      expect(served.results[0]).toMatchObject({
        base_path: 'simple',
        remote: `${API}/remotes/python/python/1/`,
        allow_uploads: false,
      });
      expect(lab.queries).toHaveLength(1);
    });

    it('changes the pull-through remote and the upload permission with one PATCH of the fields given, and reads the answer as a task or as the object', async () => {
      const row = pythonDistribution({ name: 'simple' });
      const calls = recorder();
      let answer: 'task' | 'done' = 'task';
      server.use(
        http.patch(`*${row.pulp_href}`, async ({ request }) => {
          await calls.record(request);
          return answer === 'task'
            ? HttpResponse.json({ task: TASK }, { status: 202 })
            : HttpResponse.json(row);
        }),
      );

      const started = await pythonDistributionEntity.update(row.pulp_href, {
        remote: null,
      });
      answer = 'done';
      const finished = await pythonDistributionEntity.update(row.pulp_href, {
        allow_uploads: false,
      });

      expect(started).toEqual({ kind: 'task', task: TASK });
      expect(finished).toMatchObject({
        kind: 'done',
        object: { name: 'simple' },
      });
      expect(calls.seen.map(({ method, body }) => [method, body])).toEqual([
        ['PATCH', { remote: null }],
        ['PATCH', { allow_uploads: false }],
      ]);
    });

    it('reads one distribution by its address', async () => {
      const row = pythonDistribution({ name: 'simple' });
      server.use(http.get(`*${row.pulp_href}`, () => HttpResponse.json(row)));

      expect(
        await pythonDistributionEntity.retrieve(row.pulp_href),
      ).toMatchObject({ name: 'simple', allow_uploads: true });
    });
  });
});
