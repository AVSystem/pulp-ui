import { HttpResponse, http } from 'msw';
import { taskHref } from 'src/entities/core/task/href';
import {
  type ITaskRow,
  pluginRepository,
  taskListHandler,
  taskRow,
} from './pulp';
import { server } from './server';

// The file plugin as the server answers a sync and the reads that follow it: the
// repository, its tasks (the list the active and the last task are looked up in
// and the task itself), the request that starts a sync and the request that
// cancels a task. A test changes the tasks as the server would, and what the
// code sent is recorded.

export const API = '/pulp/api/v3';
export const SYNC_TASK = 'pulp_file.app.tasks.synchronizing.synchronize';
const SYNC_PATH = `${API}/repositories/file/file/:id/sync/`;

export interface Lab {
  repository: ReturnType<typeof pluginRepository>;
  // The tasks the server holds, newest changes first. Change it in place.
  tasks: ITaskRow[];
  // The reads of the task list, by their query, and the number of reads of one
  // task.
  lists: URLSearchParams[];
  details: () => number;
  // What the requests that start a sync and cancel a task carried.
  syncs: { path: string; body: Record<string, unknown> }[];
  cancels: { path: string; body: Record<string, unknown> }[];
  // Makes the read of one task, or the request that cancels, answer with this
  // status from now on; null answers as before.
  failDetail: (status: number | null) => void;
  failCancel: (status: number | null, body?: unknown) => void;
  // Changes the task with this address, as a worker would.
  change: (task: string, overrides: Partial<ITaskRow>) => void;
  // The state a started sync's task is made in.
  startAs: (state: string) => void;
  // A task of this repository as the server lists it.
  add: (overrides?: Partial<ITaskRow>) => ITaskRow;
}

// One report of a task, as the server writes it.
export const report = (
  message: string,
  done: number,
  total: number | null = null,
  state = 'running',
) => ({ message, code: 'sync.fake', state, done, total });

export function serveSyncLab({
  repository = pluginRepository('file', {
    name: 'tools',
    remote: `${API}/remotes/file/file/00000000-0000-4000-8000-000000000999/`,
  }),
  tasks = [],
}: {
  repository?: ReturnType<typeof pluginRepository>;
  tasks?: Partial<ITaskRow>[];
} = {}): Lab {
  const rows: ITaskRow[] = [];
  const syncs: Lab['syncs'] = [];
  const cancels: Lab['cancels'] = [];
  let detailReads = 0;
  let detailStatus: number | null = null;
  let cancelStatus: { status: number; body: unknown } | null = null;
  let startState = 'waiting';

  const add = (overrides: Partial<ITaskRow> = {}) => {
    const row = taskRow({
      name: SYNC_TASK,
      state: 'running',
      reserved_resources_record: [repository.prn as string],
      ...overrides,
    });
    rows.unshift(row);
    return row;
  };
  for (const overrides of tasks) {
    add(overrides);
  }

  const list = taskListHandler(rows, {
    prns: { [repository.pulp_href]: repository.prn as string },
  });

  server.use(list.handler);

  server.use(
    http.get(`*${API}/tasks/:id/`, ({ params }) => {
      detailReads += 1;
      if (detailStatus !== null) {
        return HttpResponse.json(
          { detail: 'The task cannot be read.' },
          { status: detailStatus },
        );
      }
      const found = rows.find(({ pulp_href }) =>
        pulp_href.endsWith(`/${String(params.id)}/`),
      );
      return found
        ? HttpResponse.json(found)
        : HttpResponse.json({ detail: 'Not found.' }, { status: 404 });
    }),
    http.patch(`*${API}/tasks/:id/`, async ({ request, params }) => {
      cancels.push({
        path: new URL(request.url).pathname,
        body: (await request.json()) as Record<string, unknown>,
      });
      if (cancelStatus !== null) {
        return HttpResponse.json(cancelStatus.body, {
          status: cancelStatus.status,
        });
      }
      const found = rows.find(({ pulp_href }) =>
        pulp_href.endsWith(`/${String(params.id)}/`),
      );
      if (found) {
        found.state = 'canceled';
      }
      return HttpResponse.json(found ?? {});
    }),
    http.post(`*${SYNC_PATH}`, async ({ request }) => {
      syncs.push({
        path: new URL(request.url).pathname,
        body: (await request.json()) as Record<string, unknown>,
      });
      const row = add({ state: startState });
      return HttpResponse.json(
        { task: taskHref(row.pulp_href.split('/').filter(Boolean).pop()) },
        { status: 202 },
      );
    }),
  );

  return {
    repository,
    tasks: rows,
    lists: list.queries,
    details: () => detailReads,
    syncs,
    cancels,
    failDetail: (status) => {
      detailStatus = status;
    },
    failCancel: (status, body = { detail: 'no' }) => {
      cancelStatus = status === null ? null : { status, body };
    },
    change: (task, overrides) => {
      const found = rows.find(({ pulp_href }) => pulp_href === task);
      if (found) {
        Object.assign(found, overrides);
      }
    },
    startAs: (state) => {
      startState = state;
    },
    add,
  };
}
