import type { TasksListParams } from '@pulp-ui/sdk/core/models/tasks/tasks-list-params.zod';
import { tasksCancel, tasksList, tasksRead } from '@pulp-ui/sdk/core/tasks';
import { positiveInt } from 'src/entities/page-params';
import { parseResponse } from 'src/entities/response-shape';
import {
  DEFAULT_PAGE_SIZE,
  type Task,
  type TaskCountFilter,
  type TaskListParams,
  type TaskPage,
  taskPageSchema,
  taskSchema,
} from './model';

// Turns the page, size and sort of the screen into what the server takes:
// an offset, a limit and an ordering. A filter that is not set is not sent.
function toRequestParams(params: TaskListParams): TasksListParams {
  const limit = positiveInt(params.page_size, DEFAULT_PAGE_SIZE);
  const page = positiveInt(params.page, 1);
  const request: TasksListParams = { offset: (page - 1) * limit, limit };

  if (params.sort) {
    // The server rejects an ordering it does not know; that answer is shown
    // as a failed read.
    request.ordering = [params.sort] as TasksListParams['ordering'];
  }
  if (params.name__contains) {
    request.name__contains = params.name__contains;
  }
  if (params.state) {
    request.state = params.state as TasksListParams['state'];
  }
  if (params.state__in) {
    request.state__in = params.state__in.split(',').filter(Boolean);
  }
  if (params.finishedWithinMs !== undefined) {
    request.finished_at__gte = new Date(
      Date.now() - params.finishedWithinMs,
    ).toISOString();
  }

  return request;
}

// Lists one page of tasks. The options reach `fetch`, so an abort signal
// cancels the request. An answer that does not match the model is a
// ResponseShapeError.
async function list(
  params: TaskListParams,
  options?: RequestInit,
): Promise<TaskPage> {
  const data = await tasksList(toRequestParams(params), options);
  return parseResponse(taskPageSchema, data);
}

// How many tasks match the filter, taken from the total of a page of one row,
// so nothing but the total is transferred.
async function count(
  filter: TaskCountFilter,
  options?: RequestInit,
): Promise<number> {
  const page = await list({ ...filter, page_size: 1 }, options);
  return page.count;
}

// Reads one task by its address.
async function retrieve(href: string, options?: RequestInit): Promise<Task> {
  const data = await tasksRead(href, undefined, options);
  return parseResponse(taskSchema, data);
}

// Asks the server to stop one task. The server decides whether it may.
async function cancel(href: string, options?: RequestInit): Promise<Task> {
  const data = await tasksCancel(href, { state: 'canceled' }, options);
  return parseResponse(taskSchema, data);
}

export const TaskClient = { list, count, retrieve, cancel };
