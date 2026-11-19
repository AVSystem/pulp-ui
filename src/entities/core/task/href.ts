import { config } from 'src/ui-config';

// A task is addressed in the browser by its id and held inside the app by its
// pulp_href. These two functions are the only place that turns the one into
// the other: a screen that built a task path by hand could send a request to
// something that is not a task.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ID_ONLY = new RegExp(`^${UUID}$`, 'i');
const TASK_HREF = new RegExp(`(?:^|/)tasks/(${UUID})/?$`, 'i');

// The address of the task with this id, or null when the text is not an id.
// Whatever a visitor typed into the address bar reaches a request only through
// here, so only a bare id is accepted.
export function taskHref(urlId: string | null | undefined): string | null {
  return typeof urlId === 'string' && ID_ONLY.test(urlId)
    ? `${config.API_BASE_PATH}tasks/${urlId}/`
    : null;
}

// The id of the task a pulp_href names, or null when it names anything else.
export function taskUrlId(href: string | null | undefined): string | null {
  if (typeof href !== 'string') {
    return null;
  }
  const path = href.split(/[?#]/)[0];
  return TASK_HREF.exec(path)?.[1] ?? null;
}
