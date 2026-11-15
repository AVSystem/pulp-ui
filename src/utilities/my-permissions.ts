import { type ActionType } from '../actions/action';
import { GenericPulpAPI } from '../api/generic-pulp';
import { config } from '../ui-config';

// The permissions the signed-in user holds on one object, as the server lists
// them for it. Roles granted on a single object appear only here: a role
// granted on every object does not (it is read once for the user instead).
// Any failure answers none, so a refused or failed read hides what it would
// have shown and never raises an error of its own. What is shown from this is
// presentation only: the server decides every request.
export async function loadMyPermissions(href: string): Promise<string[]> {
  try {
    const base = config.API_BASE_PATH;
    const path = href.startsWith(base) ? href.slice(base.length) : href;
    const { data } = await GenericPulpAPI.get(`${path}my_permissions/`);
    return Array.isArray(data?.permissions) ? data.permissions : [];
  } catch {
    return [];
  }
}

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
// object counts as holding nothing until its read has answered. Every object
// is read once; reset forgets all of it, for a new session.
export class ObjectPermissions {
  private lists = new Map<string, string[]>();
  private reading = new Set<string>();
  // Identifies the cache's generation, so an answer that arrives after a
  // reset, or after the screen is gone, is dropped.
  private generation = 0;

  constructor(private readonly changed: () => void) {}

  read(href?: string | null) {
    if (!href || this.lists.has(href) || this.reading.has(href)) {
      return;
    }

    const generation = this.generation;
    this.reading.add(href);
    loadMyPermissions(href).then((list) => {
      if (generation !== this.generation) {
        return;
      }
      this.reading.delete(href);
      this.lists.set(href, list);
      this.changed();
    });
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
    this.changed();
  }

  // Drops everything still on its way.
  dispose() {
    this.generation++;
  }
}
