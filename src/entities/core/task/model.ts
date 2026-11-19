import { z } from 'zod';
import { pulpHrefSchema } from 'src/entities/href';

// The fields the task screens and the shell read, and nothing else. A field
// this schema does not name is kept as it came, so a later server version
// cannot break a page. The address and the name and state a row is shown by
// are required: an answer without them is not a task. Everything else the
// server may leave out or send as null.
//
// The generated response schema of the sdk is used for types only.
const taskSchema = z.looseObject({
  pulp_href: pulpHrefSchema,
  prn: z.string().nullish(),
  name: z.string(),
  state: z.string(),
  pulp_created: z.string().nullish(),
  started_at: z.string().nullish(),
  finished_at: z.string().nullish(),
  error: z.record(z.string(), z.unknown()).nullish(),
  worker: z.string().nullish(),
  logging_cid: z.string().nullish(),
  parent_task: z.string().nullish(),
  child_tasks: z.array(z.string()).optional(),
  created_resources: z.array(z.string()).optional(),
  reserved_resources_record: z.array(z.string()).nullish(),
  progress_reports: z.array(z.looseObject({})).optional(),
  // present only when the list was asked for the permissions of each row
  my_permissions: z.array(z.string()).optional(),
});

const taskPageSchema = z.looseObject({
  count: z.number(),
  next: z.string().nullish(),
  previous: z.string().nullish(),
  results: z.array(taskSchema),
});

type Task = z.infer<typeof taskSchema>;
type TaskPage = z.infer<typeof taskPageSchema>;

// What a task list is asked for, in the terms of the address of the screen:
// the page and its size, the column to sort by (a leading minus sorts down),
// and the two filters the screen offers.
interface TaskListParams {
  page?: number;
  page_size?: number;
  sort?: string;
  name__contains?: string;
  state?: string;
}

const DEFAULT_PAGE_SIZE = 10;

// A task in one of these states no longer changes.
const FINAL_STATES = ['completed', 'failed', 'canceled', 'skipped'];

function isFinalState(state: string): boolean {
  return FINAL_STATES.includes(state);
}

export { DEFAULT_PAGE_SIZE, isFinalState, taskPageSchema, taskSchema };
export type { Task, TaskListParams, TaskPage };
