import { apiPathOfHref } from 'src/entities/href';
import { type ActionType } from '../actions/action';
import { GenericPulpAPI } from '../api/generic-pulp';

// The permissions the signed-in user holds on one object, as the server lists
// them for it. Roles granted on a single object appear only here: a role
// granted on every object does not (it is read once for the user instead).
// A failure, or an answer without a list, answers null: it is not an answer,
// so it is never taken for "holds nothing" and never raises an error of its
// own. An empty list is a real answer. What is shown from this is
// presentation only: the server decides every request.
export async function loadMyPermissions(
  href: string,
): Promise<string[] | null> {
  try {
    // An address outside the API base names no object of this API: nothing is
    // asked and the answer is "unknown".
    const path = apiPathOfHref(href);
    if (path === null) {
      return null;
    }
    const { data } = await GenericPulpAPI.get(
      `${path}${path.endsWith('/') ? '' : '/'}my_permissions/`,
    );
    return Array.isArray(data?.permissions) ? data.permissions : null;
  } catch {
    return null;
  }
}

// How long an object whose read failed is left alone before it is asked again:
// long enough that a persistent failure does not turn every render into a
// request, short enough that a passing failure does not hide actions for the
// rest of the visit.
export const FAILED_READ_PAUSE_MS = 30_000;

interface IPermissionContext {
  hasPermission?: (name: string) => boolean;
  permissionsReady?: boolean;
}

// True when one of the actions can only be decided by the permissions of the
// object it acts on: the global permissions are known, and the user does not
// hold the action's permission globally (staff hold every one). Until the
// global permissions are known nothing is read, because nothing is shown yet.
export function needsObjectPermissions(
  actions: ActionType[] | undefined,
  { hasPermission, permissionsReady }: IPermissionContext,
): boolean {
  return (
    !!permissionsReady &&
    !!actions?.some(
      (action) =>
        action.permission &&
        action.objectLevel &&
        !hasPermission?.(action.permission),
    )
  );
}

// The object permissions read for the objects of one screen, by address. An
// object counts as holding nothing until its read has answered. An answer is
// read once and remembered; a failed read is not remembered as an answer, and
// the object is asked again on a later read once the pause has passed. reset
// forgets all of it, for a new session.
export class ObjectPermissions {
  private lists = new Map<string, string[]>();
  private reading = new Set<string>();
  // when the last read of an object failed, by address
  private failures = new Map<string, number>();
  // Identifies the cache's generation, so an answer that arrives after a
  // reset, or after the screen is gone, is dropped.
  private generation = 0;

  constructor(private readonly changed: () => void) {}

  read(href?: string | null) {
    if (!href || this.lists.has(href) || this.reading.has(href)) {
      return;
    }

    const failedAt = this.failures.get(href);
    if (
      failedAt !== undefined &&
      Date.now() - failedAt < FAILED_READ_PAUSE_MS
    ) {
      return;
    }

    const generation = this.generation;
    this.reading.add(href);
    loadMyPermissions(href).then((list) => {
      if (generation !== this.generation) {
        return;
      }
      this.reading.delete(href);

      if (list === null) {
        this.failures.set(href, Date.now());
      } else {
        this.failures.delete(href);
        this.lists.set(href, list);
      }
      this.changed();
    });
  }

  // True when the object's permissions are known: it carries the list itself,
  // or the read for its address has answered.
  knows(
    object:
      { pulp_href?: string; my_permissions?: string[] } | null | undefined,
  ): boolean {
    return (
      Array.isArray(object?.my_permissions) ||
      this.lists.has(object?.pulp_href ?? '')
    );
  }

  // True when the last read for the object's address failed and no later read
  // has answered. The object's permissions are still unknown then, but a
  // screen that waits for them has an answer to act on: nothing is shown.
  failed(object: { pulp_href?: string } | null | undefined): boolean {
    return this.failures.has(object?.pulp_href ?? '');
  }

  // True when the permission is held everywhere, or listed for the object:
  // by the object itself when it carries the list, else by the answer read
  // for its address.
  holds(
    permission: string,
    object:
      { pulp_href?: string; my_permissions?: string[] } | null | undefined,
    hasPermission: (name: string) => boolean,
  ): boolean {
    return (
      hasPermission(permission) ||
      !!object?.my_permissions?.includes?.(permission) ||
      !!this.lists.get(object?.pulp_href ?? '')?.includes(permission)
    );
  }

  reset() {
    this.generation++;
    this.lists.clear();
    this.reading.clear();
    this.failures.clear();
    this.changed();
  }

  // Drops everything still on its way.
  dispose() {
    this.generation++;
  }
}
