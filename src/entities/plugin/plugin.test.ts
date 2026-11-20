import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { type ReactNode, createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { fileRemote } from 'src/entities/file/remote';
import { fileRepository } from 'src/entities/file/repository';
import { ResponseShapeError } from 'src/entities/response-shape';
import {
  listOf,
  page,
  pluginListHandler,
  pluginRemote,
  pluginRepository,
} from 'src/test-utils/pulp';
import { createTestQueryClient } from 'src/test-utils/query';
import { server } from 'src/test-utils/server';
import {
  entityKeys,
  useCreateEntity,
  useDeleteEntity,
  useEntity,
  useEntityByName,
  useEntityList,
  useSetLabel,
  useUnsetLabel,
  useUpdateEntity,
} from './queries';

const REPOSITORIES = '/pulp/api/v3/repositories/file/file/';
const REMOTES = '/pulp/api/v3/remotes/file/file/';
const TASK = '/pulp/api/v3/tasks/00000000-0000-4000-8000-00000000f002/';

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

// A client with the retry defaults of the application's mutations turned up,
// so a mutation that does not switch retrying off for itself is caught.
function retryingClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: 3, retryDelay: 1 },
    },
  });
}

function recorder() {
  const seen: { method: string; url: URL; body: unknown }[] = [];
  return {
    seen,
    async record(request: Request) {
      const text = await request.clone().text();
      seen.push({
        method: request.method,
        url: new URL(request.url),
        body: text ? JSON.parse(text) : undefined,
      });
    },
  };
}

describe('Unit: the file remote entity', { tags: ['unit'] }, () => {
  it('names the plugin and the object it keys its reads by', () => {
    expect(fileRemote.app).toBe('file');
    expect(fileRemote.object).toBe('remote');
  });

  it('lists a page by size, sort and filters', async () => {
    const rows = listOf(REMOTES, [pluginRemote('file', { name: 'a' })]);
    server.use(rows.handler);

    await fileRemote.list({
      page: 2,
      page_size: 10,
      sort: '-url',
      name__icontains: 'mirror',
      pulp_label_select: 'team',
    });

    expect(Object.fromEntries(rows.queries[0])).toEqual({
      offset: '10',
      limit: '10',
      ordering: '-url',
      name__icontains: 'mirror',
      pulp_label_select: 'team',
    });
  });

  it('finds a remote by its exact name and answers null for none', async () => {
    const wanted = pluginRemote('file', { name: 'a b' });
    const rows = pluginListHandler('file', 'remote', [wanted]);
    server.use(rows.handler);

    expect(await fileRemote.byName('a b')).toMatchObject({
      pulp_href: wanted.pulp_href,
    });
    expect(await fileRemote.byName('nope')).toBeNull();
    expect(await fileRemote.byName('')).toBeNull();
    expect(Object.fromEntries(rows.queries[0])).toEqual({
      name: 'a b',
      limit: '1',
    });
    expect(rows.queries).toHaveLength(2);
  });

  it('reads a remote by its address and keeps what the model does not name', async () => {
    const row = pluginRemote('file', { policy: 'on_demand', new_field: 7 });
    server.use(http.get(`*${row.pulp_href}`, () => HttpResponse.json(row)));

    expect(await fileRemote.retrieve(row.pulp_href)).toMatchObject({
      url: row.url,
      policy: 'on_demand',
      new_field: 7,
    });
  });

  it('refuses a remote whose address leads away from the server', async () => {
    const row = pluginRemote('file', { pulp_href: 'https://other.example/r/' });
    server.use(http.get(`*${REMOTES}`, () => HttpResponse.json(page([row]))));

    await expect(fileRemote.list({})).rejects.toBeInstanceOf(
      ResponseShapeError,
    );
  });

  it('creates a remote with one POST of the given fields', async () => {
    const calls = recorder();
    server.use(
      http.post(`*${REMOTES}`, async ({ request }) => {
        await calls.record(request);
        return HttpResponse.json(pluginRemote('file', { name: 'new' }), {
          status: 201,
        });
      }),
    );

    const created = await fileRemote.create({
      name: 'new',
      url: 'https://pulp.example/a/',
      pulp_labels: { team: 'ops' },
    });

    expect(created.name).toBe('new');
    expect(calls.seen).toHaveLength(1);
    expect(calls.seen[0].body).toEqual({
      name: 'new',
      url: 'https://pulp.example/a/',
      pulp_labels: { team: 'ops' },
    });
  });

  it('updates with one PATCH that holds the given fields only', async () => {
    const row = pluginRemote('file');
    const calls = recorder();
    server.use(
      http.patch(`*${row.pulp_href}`, async ({ request }) => {
        await calls.record(request);
        return HttpResponse.json({ task: TASK }, { status: 202 });
      }),
    );

    const result = await fileRemote.update(row.pulp_href, {
      url: 'https://pulp.example/b/',
    });

    expect(result).toEqual({ kind: 'task', task: TASK });
    expect(calls.seen).toHaveLength(1);
    expect(calls.seen[0].method).toBe('PATCH');
    expect(calls.seen[0].body).toEqual({ url: 'https://pulp.example/b/' });
  });

  it('returns the task a delete starts', async () => {
    const row = pluginRemote('file');
    server.use(
      http.delete(`*${row.pulp_href}`, () =>
        HttpResponse.json({ task: TASK }, { status: 202 }),
      ),
    );

    expect(await fileRemote.remove(row.pulp_href)).toBe(TASK);
  });

  it('sets and unsets a label with one POST each', async () => {
    const row = pluginRemote('file');
    const calls = recorder();
    server.use(
      http.post(`*${row.pulp_href}set_label/`, async ({ request }) => {
        await calls.record(request);
        return HttpResponse.json({ key: 'team', value: 'ops' });
      }),
      http.post(`*${row.pulp_href}unset_label/`, async ({ request }) => {
        await calls.record(request);
        return HttpResponse.json({ key: 'team', value: 'ops' });
      }),
    );

    await fileRemote.setLabel(row.pulp_href, { key: 'team', value: 'ops' });
    await fileRemote.unsetLabel(row.pulp_href, 'team');

    expect(calls.seen.map((call) => call.url.pathname)).toEqual([
      `${row.pulp_href}set_label/`,
      `${row.pulp_href}unset_label/`,
    ]);
    expect(calls.seen.map((call) => call.body)).toEqual([
      { key: 'team', value: 'ops' },
      { key: 'team' },
    ]);
  });

  it('has no sync, versions or modify', () => {
    expect('sync' in fileRemote).toBe(false);
    expect('versions' in fileRemote).toBe(false);
    expect('modify' in fileRemote).toBe(false);
  });
});

describe('Unit: entityKeys', { tags: ['unit'] }, () => {
  it('starts with the app and the object and names the kind of read', () => {
    const keys = entityKeys(fileRepository);

    expect(keys.all).toEqual(['pulp', 'file', 'repository']);
    expect(keys.list({ page: 2 }).slice(0, 4)).toEqual([
      'pulp',
      'file',
      'repository',
      'list',
    ]);
    expect(keys.byName('a').slice(0, 4)).toEqual([
      'pulp',
      'file',
      'repository',
      'by-name',
    ]);
    expect(keys.detail('/pulp/api/v3/x/').slice(0, 4)).toEqual([
      'pulp',
      'file',
      'repository',
      'detail',
    ]);
    expect(entityKeys(fileRemote).all).toEqual(['pulp', 'file', 'remote']);
  });

  it('differ by their parameters', () => {
    const keys = entityKeys(fileRepository);

    expect(keys.list({ name__icontains: 'a' })).not.toEqual(
      keys.list({ name__icontains: 'ab' }),
    );
    expect(keys.byName('a')).not.toEqual(keys.byName('b'));
  });
});

describe('Unit: useEntityList', { tags: ['unit'] }, () => {
  // A list that holds the answer of one page back until the test lets it go.
  function heldList(rowsByPage: Record<string, string[]>) {
    const releases: (() => void)[] = [];
    const seen: URLSearchParams[] = [];
    server.use(
      http.get(`*${REPOSITORIES}`, async ({ request }) => {
        const query = new URL(request.url).searchParams;
        seen.push(query);
        const key = `${query.get('offset')}|${query.get('name__icontains') ?? ''}`;
        if (!(key in rowsByPage)) {
          await new Promise<void>((resolve) => releases.push(resolve));
        }
        const names = rowsByPage[key] ?? ['late'];
        return HttpResponse.json(
          page(names.map((name) => pluginRepository('file', { name }))),
        );
      }),
    );
    return { releases, seen };
  }

  it('reads a page of the list', async () => {
    const rows = listOf(REPOSITORIES, [
      pluginRepository('file', { name: 'a' }),
      pluginRepository('file', { name: 'b' }),
    ]);
    server.use(rows.handler);
    const client = createTestQueryClient();

    const { result } = renderHook(
      () => useEntityList(fileRepository, { page_size: 10 }),
      { wrapper: wrapperFor(client) },
    );

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.results.map((row) => row.name)).toEqual([
      'a',
      'b',
    ]);
    expect(rows.queries).toHaveLength(1);
  });

  it('keeps the rows on screen while another page of the same list loads', async () => {
    const held = heldList({ '0|': ['first'] });
    const client = createTestQueryClient();

    const { result, rerender } = renderHook(
      ({ page: number }) =>
        useEntityList(fileRepository, { page: number, page_size: 1 }),
      { wrapper: wrapperFor(client), initialProps: { page: 1 } },
    );
    await waitFor(() =>
      expect(result.current.data?.results[0].name).toBe('first'),
    );

    rerender({ page: 2 });

    await waitFor(() => expect(held.seen).toHaveLength(2));
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data?.results[0].name).toBe('first');

    act(() => held.releases.forEach((release) => release()));
    await waitFor(() =>
      expect(result.current.data?.results[0].name).toBe('late'),
    );
  });

  it('shows no rows read for another filter while a new filter loads', async () => {
    const held = heldList({ '0|': ['first'] });
    const client = createTestQueryClient();

    const { result, rerender } = renderHook(
      ({ text }: { text: string }) =>
        useEntityList(fileRepository, { page_size: 1, name__icontains: text }),
      { wrapper: wrapperFor(client), initialProps: { text: '' } },
    );
    await waitFor(() =>
      expect(result.current.data?.results[0].name).toBe('first'),
    );

    rerender({ text: 'x' });

    await waitFor(() => expect(held.seen).toHaveLength(2));
    expect(result.current.data).toBeUndefined();

    act(() => held.releases.forEach((release) => release()));
    await waitFor(() => expect(result.current.data).toBeDefined());
  });

  it('sends no request while it is switched off', async () => {
    const rows = listOf(REPOSITORIES, [pluginRepository('file')]);
    server.use(rows.handler);

    const { result } = renderHook(
      () => useEntityList(fileRepository, {}, { enabled: false }),
      { wrapper: wrapperFor(createTestQueryClient()) },
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(rows.queries).toHaveLength(0);
  });
});

describe('Unit: useEntity and useEntityByName', { tags: ['unit'] }, () => {
  it('sends nothing for a null address', () => {
    const { result } = renderHook(() => useEntity(fileRepository, null), {
      wrapper: wrapperFor(createTestQueryClient()),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.data).toBeUndefined();
  });

  it('reads one repository by its address', async () => {
    const row = pluginRepository('file', { name: 'a' });
    server.use(http.get(`*${row.pulp_href}`, () => HttpResponse.json(row)));

    const { result } = renderHook(
      () => useEntity(fileRepository, row.pulp_href),
      { wrapper: wrapperFor(createTestQueryClient()) },
    );

    await waitFor(() => expect(result.current.data?.name).toBe('a'));
  });

  it('finds a repository by name, and settles on null when there is none', async () => {
    const row = pluginRepository('file', { name: 'a b' });
    const rows = pluginListHandler('file', 'repository', [row]);
    server.use(rows.handler);
    const client = createTestQueryClient();

    const found = renderHook(() => useEntityByName(fileRepository, 'a b'), {
      wrapper: wrapperFor(client),
    });
    const missing = renderHook(() => useEntityByName(fileRepository, 'zz'), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() =>
      expect(found.result.current.data?.pulp_href).toBe(row.pulp_href),
    );
    await waitFor(() => expect(missing.result.current.isSuccess).toBe(true));
    expect(missing.result.current.data).toBeNull();
  });

  it('sends nothing for no name', () => {
    const rows = listOf(REPOSITORIES, [pluginRepository('file')]);
    server.use(rows.handler);

    const { result } = renderHook(() => useEntityByName(fileRepository, null), {
      wrapper: wrapperFor(createTestQueryClient()),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(rows.queries).toHaveLength(0);
  });
});

describe('Unit: the entity mutations', { tags: ['unit'] }, () => {
  // A list handler that counts its reads, and a hook that holds the list
  // open next to the mutation, so a refetch after the mutation is visible.
  function withOpenList() {
    const rows = listOf(REPOSITORIES, [
      pluginRepository('file', { name: 'a' }),
    ]);
    server.use(rows.handler);
    return rows;
  }

  it('sets a label with one POST and reads the object again afterwards', async () => {
    const row = pluginRepository('file');
    const rows = withOpenList();
    const calls = recorder();
    server.use(
      http.post(`*${row.pulp_href}set_label/`, async ({ request }) => {
        await calls.record(request);
        return HttpResponse.json({ key: 'team', value: 'ops' });
      }),
    );

    const { result } = renderHook(
      () => ({
        list: useEntityList(fileRepository, {}),
        set: useSetLabel(fileRepository),
      }),
      { wrapper: wrapperFor(retryingClient()) },
    );
    await waitFor(() => expect(result.current.list.data).toBeDefined());

    act(() =>
      result.current.set.mutate({
        href: row.pulp_href,
        key: 'team',
        value: 'ops',
      }),
    );

    await waitFor(() => expect(result.current.set.isSuccess).toBe(true));
    await waitFor(() => expect(rows.queries).toHaveLength(2));
    expect(calls.seen).toHaveLength(1);
    expect(calls.seen[0].body).toEqual({ key: 'team', value: 'ops' });
  });

  it('unsets a label with one POST and reads the object again afterwards', async () => {
    const row = pluginRepository('file');
    const rows = withOpenList();
    const calls = recorder();
    server.use(
      http.post(`*${row.pulp_href}unset_label/`, async ({ request }) => {
        await calls.record(request);
        return HttpResponse.json({ key: 'team', value: 'ops' });
      }),
    );

    const { result } = renderHook(
      () => ({
        list: useEntityList(fileRepository, {}),
        unset: useUnsetLabel(fileRepository),
      }),
      { wrapper: wrapperFor(retryingClient()) },
    );
    await waitFor(() => expect(result.current.list.data).toBeDefined());

    act(() =>
      result.current.unset.mutate({ href: row.pulp_href, key: 'team' }),
    );

    await waitFor(() => expect(result.current.unset.isSuccess).toBe(true));
    await waitFor(() => expect(rows.queries).toHaveLength(2));
    expect(calls.seen).toHaveLength(1);
    expect(calls.seen[0].body).toEqual({ key: 'team' });
  });

  it('never repeats a failed write by itself', async () => {
    const row = pluginRepository('file');
    const calls = recorder();
    server.use(
      http.post(`*${row.pulp_href}set_label/`, async ({ request }) => {
        await calls.record(request);
        return HttpResponse.json({ detail: 'no' }, { status: 500 });
      }),
      http.post(`*${row.pulp_href}unset_label/`, async ({ request }) => {
        await calls.record(request);
        return HttpResponse.json({ detail: 'no' }, { status: 500 });
      }),
      http.delete(`*${row.pulp_href}`, async ({ request }) => {
        await calls.record(request);
        return HttpResponse.json({ detail: 'no' }, { status: 500 });
      }),
      http.patch(`*${row.pulp_href}`, async ({ request }) => {
        await calls.record(request);
        return HttpResponse.json({ detail: 'no' }, { status: 500 });
      }),
      http.post(`*${REPOSITORIES}`, async ({ request }) => {
        await calls.record(request);
        return HttpResponse.json({ detail: 'no' }, { status: 500 });
      }),
    );

    const { result } = renderHook(
      () => ({
        set: useSetLabel(fileRepository),
        unset: useUnsetLabel(fileRepository),
        remove: useDeleteEntity(fileRepository),
        update: useUpdateEntity(fileRepository),
        create: useCreateEntity(fileRepository),
      }),
      { wrapper: wrapperFor(retryingClient()) },
    );

    act(() => {
      result.current.set.mutate({ href: row.pulp_href, key: 'a', value: 'b' });
      result.current.unset.mutate({ href: row.pulp_href, key: 'a' });
      result.current.remove.mutate({ href: row.pulp_href });
      result.current.update.mutate({ href: row.pulp_href, body: {} });
      result.current.create.mutate({ name: 'x' });
    });

    await waitFor(() => {
      expect(result.current.set.isError).toBe(true);
      expect(result.current.unset.isError).toBe(true);
      expect(result.current.remove.isError).toBe(true);
      expect(result.current.update.isError).toBe(true);
      expect(result.current.create.isError).toBe(true);
    });
    // time for a repeat that would have been scheduled
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls.seen).toHaveLength(5);
  });

  it('creates, updates and deletes with one request each and reads the lists again', async () => {
    const row = pluginRepository('file', { name: 'a' });
    const rows = withOpenList();
    const calls = recorder();
    server.use(
      http.post(`*${REPOSITORIES}`, async ({ request }) => {
        await calls.record(request);
        return HttpResponse.json(pluginRepository('file', { name: 'n' }), {
          status: 201,
        });
      }),
      http.patch(`*${row.pulp_href}`, async ({ request }) => {
        await calls.record(request);
        return HttpResponse.json({ task: TASK }, { status: 202 });
      }),
      http.delete(`*${row.pulp_href}`, async ({ request }) => {
        await calls.record(request);
        return HttpResponse.json({ task: TASK }, { status: 202 });
      }),
    );

    const { result } = renderHook(
      () => ({
        list: useEntityList(fileRepository, {}),
        create: useCreateEntity(fileRepository),
        update: useUpdateEntity(fileRepository),
        remove: useDeleteEntity(fileRepository),
      }),
      { wrapper: wrapperFor(retryingClient()) },
    );
    await waitFor(() => expect(result.current.list.data).toBeDefined());

    act(() => result.current.create.mutate({ name: 'n' }));
    await waitFor(() => expect(result.current.create.isSuccess).toBe(true));
    await waitFor(() => expect(rows.queries).toHaveLength(2));

    act(() =>
      result.current.update.mutate({
        href: row.pulp_href,
        body: { description: 'd' },
      }),
    );
    await waitFor(() => expect(result.current.update.isSuccess).toBe(true));
    await waitFor(() => expect(rows.queries).toHaveLength(3));
    expect(result.current.update.data).toEqual({ kind: 'task', task: TASK });

    act(() => result.current.remove.mutate({ href: row.pulp_href }));
    await waitFor(() => expect(result.current.remove.isSuccess).toBe(true));
    await waitFor(() => expect(rows.queries).toHaveLength(4));
    expect(result.current.remove.data).toBe(TASK);

    expect(calls.seen.map((call) => call.method)).toEqual([
      'POST',
      'PATCH',
      'DELETE',
    ]);
  });
});
