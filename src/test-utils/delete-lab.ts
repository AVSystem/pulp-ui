import { HttpResponse, http } from 'msw';
import {
  type IDistribution,
  type IPublication,
  listOf,
  task,
} from 'src/test-utils/pulp';
import { server } from 'src/test-utils/server';

// The file plugin as the server answers a delete of a repository: the lists the
// delete reads, delete answered with a task, a task that is running for some
// reads before it completes. It records what was sent.

export const API = '/pulp/api/v3';
export const DISTRIBUTIONS = `${API}/distributions/file/file/`;
export const PUBLICATIONS = `${API}/publications/file/file/`;
export const REPOSITORIES = `${API}/repositories/file/file/`;

export const idOf = (href: string) => href.split('/').filter(Boolean).pop();

export interface Scenario {
  distributions: IDistribution[];
  publications?: IPublication[];
  // distributions whose delete the server refuses
  refused?: IDistribution[];
  // distributions whose delete task never finishes
  stuck?: IDistribution[];
  // the server refuses to delete the repository
  repositoryRefused?: boolean;
  // how many reads of a task answer "running" before it completes
  runningReads?: number;
}

// Serves the file plugin the way the server does (the lists the delete reads,
// delete answered with a task, a task that is running for some reads before it
// completes) and records what the code sent.
export function serveDeleteLab({
  distributions,
  publications = [],
  refused = [],
  stuck = [],
  repositoryRefused = false,
  runningReads = 1,
}: Scenario) {
  const deletes: string[] = [];
  const events: string[] = [];
  const listing = listOf(DISTRIBUTIONS, distributions, {
    pageSize: 1000,
    matching: (row, query) =>
      query.has('repository')
        ? row.repository === query.get('repository')
        : true,
  });
  const polls = new Map<string, number>();
  const distributionTasks = new Set<string>();
  let inFlight = 0;
  let maxInFlight = 0;

  const refusedHrefs = new Set(refused.map(({ pulp_href }) => pulp_href));
  const stuckIds = new Set(stuck.map(({ pulp_href }) => idOf(pulp_href)));

  server.use(
    listing.handler,
    listOf(PUBLICATIONS, publications, {
      pageSize: 1000,
      matching: (row, query) => row.repository === query.get('repository'),
    }).handler,
    http.delete(`*${DISTRIBUTIONS}:id/`, ({ request, params }) => {
      const path = new URL(request.url).pathname;
      deletes.push(path);
      if (refusedHrefs.has(path)) {
        return HttpResponse.json(
          { detail: 'You do not have permission to perform this action.' },
          { status: 403 },
        );
      }
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      distributionTasks.add(String(params.id));
      return HttpResponse.json(
        { task: `${API}/tasks/${params.id}/` },
        { status: 202 },
      );
    }),
    http.delete(`*${REPOSITORIES}:id/`, ({ request, params }) => {
      const path = new URL(request.url).pathname;
      deletes.push(path);
      events.push('repository-delete');
      if (repositoryRefused) {
        return HttpResponse.json(
          { detail: 'The repository is in use.' },
          { status: 403 },
        );
      }
      return HttpResponse.json(
        { task: `${API}/tasks/${params.id}/` },
        { status: 202 },
      );
    }),
    http.get(`*${API}/tasks/:id/`, ({ params }) => {
      const id = String(params.id);
      const seen = (polls.get(id) ?? 0) + 1;
      polls.set(id, seen);

      const state =
        stuckIds.has(id) || seen <= runningReads ? 'running' : 'completed';
      if (state === 'completed' && distributionTasks.has(id)) {
        distributionTasks.delete(id);
        inFlight -= 1;
        events.push(`distribution-completed:${id}`);
      }
      return HttpResponse.json({
        ...task({ pulp_href: `${API}/tasks/${id}/`, state }),
        name: 'delete',
      });
    }),
  );

  return {
    deletes,
    events,
    queries: listing.queries,
    polls,
    maxInFlight: () => maxInFlight,
  };
}
