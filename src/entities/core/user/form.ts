import type { PatchedUser } from '@pulp-ui/sdk/core/models/users/patched-user.zod';
import type { User as NewUser } from '@pulp-ui/sdk/core/models/users/user.zod';
import type { User } from './model';

// What the user form holds, one value per field, never a missing one: a text
// field always has a string. The password is empty unless one is typed.
export interface UserFormValues {
  id?: number;
  pulp_href?: string;
  username: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  password?: string;
  groups: { id: number; name: string }[];
}

const TEXT_FIELDS = ['username', 'first_name', 'last_name', 'email'] as const;

// A user as the form shows it: the fields the server left out or sent as null
// are empty texts, and the password is empty.
export function userToForm(user: User): UserFormValues {
  return {
    id: user.id ?? undefined,
    pulp_href: user.pulp_href,
    username: user.username,
    first_name: user.first_name ?? '',
    last_name: user.last_name ?? '',
    email: user.email ?? '',
    password: '',
    groups: (user.groups ?? []).map(({ id, name }) => ({ id, name })),
  };
}

// The form of a user that does not exist yet.
export function emptyUserForm(): UserFormValues {
  return {
    username: '',
    first_name: '',
    last_name: '',
    email: '',
    password: '',
    groups: [],
  };
}

// What a create sends: the fields the server accepts for a new user. Groups
// are not part of a user's own record; the server answers them and takes them
// from the group.
export function userCreateBody(form: UserFormValues): NewUser {
  return {
    username: form.username,
    first_name: form.first_name,
    last_name: form.last_name,
    email: form.email,
    password: form.password,
  };
}

// What a save sends: only the text fields that differ from the form as it was
// first shown, so a field the user did not touch is never overwritten with
// what an earlier read held. The password is sent only when one was typed; an
// empty one would reset it.
export function userChanges(
  shown: UserFormValues,
  form: UserFormValues,
): PatchedUser {
  const changes: PatchedUser = {};

  for (const field of TEXT_FIELDS) {
    if ((form[field] ?? '') !== (shown[field] ?? '')) {
      changes[field] = form[field] ?? '';
    }
  }
  if (form.password) {
    changes.password = form.password;
  }

  return changes;
}
