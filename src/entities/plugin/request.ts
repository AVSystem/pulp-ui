import type { ZodType } from 'zod';
import { positiveInt } from 'src/entities/page-params';
import { parseResponse } from 'src/entities/response-shape';
import {
  DEFAULT_PAGE_SIZE,
  type Page,
  type RepositoryListParams,
  taskResponseSchema,
} from './model';

// What the repository and the remote entity of every plugin have in common:
// how the terms of a screen become the parameters of a request, and how the
// answers of the requests that change something are read.

// The options of `fetch`, last argument of every call, so an abort signal
// cancels the request.
export type Options = RequestInit | undefined;

// What an update answers with: the address of the task the server started, or
// the object when it finished the change at once.
export type UpdateResult<Row> =
  { kind: 'task'; task: string } | { kind: 'done'; object: Row };

const TEXT_FILTERS = [
  'name',
  'name__contains',
  'name__icontains',
  'pulp_label_select',
  'remote',
] as const;

const LIST_FILTERS = ['name__in', 'pulp_href__in', 'fields'] as const;

// The filters whose empty set means that nothing matches. A server reads an
// empty set as no filter and would answer every repository.
const MATCHING_FILTERS = ['name__in', 'pulp_href__in'] as const;

// The parameters of the generated client are typed per plugin, down to the
// enumeration of the columns it sorts by; the entity builds them from the
// terms of a screen and the server rejects what it does not know.
export function asParams<T>(request: Record<string, unknown>): T {
  return request as unknown as T;
}

// Turns the page, size, sort and filters of a screen into what the server
// takes: an offset, a limit, an ordering and the filter keys. A filter that is
// not set is not sent.
export function toRequestParams(
  params: RepositoryListParams,
): Record<string, unknown> {
  const limit = positiveInt(params.page_size, DEFAULT_PAGE_SIZE);
  const page = positiveInt(params.page, 1);
  const request: Record<string, unknown> = {
    offset: (page - 1) * limit,
    limit,
  };

  if (params.sort) {
    request.ordering = [params.sort];
  }
  for (const key of TEXT_FILTERS) {
    if (params[key]) {
      request[key] = params[key];
    }
  }
  for (const key of LIST_FILTERS) {
    const values = params[key];
    if (values && values.length > 0) {
      request[key] = values;
    }
  }

  return request;
}

// Whether the parameters ask for rows out of an empty set of values.
export function matchesNothing(params: RepositoryListParams): boolean {
  return MATCHING_FILTERS.some((key) => params[key]?.length === 0);
}

// The page of a list that has no row.
export const EMPTY_PAGE: Page<never> = {
  count: 0,
  next: null,
  previous: null,
  results: [],
};

// The address of the task a request answered with.
export function taskOf(data: unknown): string {
  return parseResponse(taskResponseSchema, data).task;
}

// Reads the answer of an update: a task the server started, or the object
// itself when the change was made at once.
export function parseUpdate<Row>(
  schema: ZodType<Row>,
  data: unknown,
): UpdateResult<Row> {
  if (typeof data === 'object' && data !== null && 'task' in data) {
    return { kind: 'task', task: taskOf(data) };
  }
  return { kind: 'done', object: parseResponse(schema, data) };
}
