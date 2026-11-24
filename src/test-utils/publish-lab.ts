import { HttpResponse, http } from 'msw';
import { taskHref } from 'src/entities/core/task/href';
import { server } from './server';
import { type Lab, serveSyncLab } from './sync-lab';

// A plugin that publishes as the server answers a publish: the request that
// starts it, and the task it becomes. It builds on the sync lab, which already
// answers the reads of tasks, so a test changes the task as a worker would and
// what the code sent is recorded.

const API = '/pulp/api/v3';

export const PUBLISH_TASK = 'pulp_file.app.tasks.publishing.publish';

export interface PublishLab extends Lab {
  // The body of every publish request received.
  publishes: Record<string, unknown>[];
  // Makes the next publish request answer with this status and body; null
  // answers as before.
  refuse: (status: number | null, body?: unknown) => void;
  // The state a started publish task is made in, and the objects it reports
  // to have created once it has completed.
  publishAs: (state: string, created?: string[]) => void;
}

// `segment` is the plugin's publication collection, for example `file/file`.
export function servePublishLab(
  options: Parameters<typeof serveSyncLab>[0] & {
    segment?: string;
    taskName?: string;
  } = {},
): PublishLab {
  const { segment = 'file/file', taskName = PUBLISH_TASK, ...rest } = options;
  const lab = serveSyncLab(rest);
  const publishes: PublishLab['publishes'] = [];
  let refusal: { status: number; body: unknown } | null = null;
  let state = 'waiting';
  let created: string[] = [];

  server.use(
    http.post(`*${API}/publications/${segment}/`, async ({ request }) => {
      publishes.push((await request.json()) as Record<string, unknown>);
      if (refusal) {
        return HttpResponse.json(refusal.body, { status: refusal.status });
      }
      const row = lab.add({
        name: taskName,
        state,
        created_resources: created,
      });
      return HttpResponse.json(
        { task: taskHref(row.pulp_href.split('/').filter(Boolean).pop()) },
        { status: 202 },
      );
    }),
  );

  return {
    ...lab,
    publishes,
    refuse: (status, body = { detail: 'no' }) => {
      refusal = status === null ? null : { status, body };
    },
    publishAs: (next, objects = []) => {
      state = next;
      created = objects;
    },
  };
}
