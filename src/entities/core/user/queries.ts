import type { PatchedUser } from '@pulp-ui/sdk/core/models/users/patched-user.zod';
import type { User as NewUser } from '@pulp-ui/sdk/core/models/users/user.zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSessionQuery } from 'src/query/use-session-query';
import { useUserContext } from 'src/user-context';
import { UserClient } from './client';
import { userHref, userUrlId } from './href';
import { type UserListParams } from './model';

const all = ['pulp', 'core', 'user'] as const;

export const userKeys = {
  all,
  list: (params: UserListParams) => [...all, 'list', params] as const,
  detail: (href: string) => [...all, 'detail', href] as const,
  // The removals of users, for telling whether one is under way.
  removals: [...all, 'removal'] as const,
};

// Whether two lists differ in the page only, so the rows of the one are a fair
// stand-in for the other while it loads. The same page of the same list is not
// a stand-in but the same read: when the cache was emptied for another account
// the previous rows belong to the account that left and are never shown.
function otherPageOfSameList(a: UserListParams, b: UserListParams): boolean {
  return (
    a.page !== b.page &&
    a.page_size === b.page_size &&
    a.sort === b.sort &&
    a.username__contains === b.username__contains &&
    a.first_name__contains === b.first_name__contains &&
    a.last_name__contains === b.last_name__contains &&
    a.email__contains === b.email__contains
  );
}

// One page of users. Every set of parameters is a query of its own, so an
// older answer never lands in the place of a newer one. While another page of
// the same list loads, the rows of the page before stay; rows that were read
// for other filters or another order are never shown in their place.
export function useUsers(
  params: UserListParams,
  { staleTime }: { staleTime?: number } = {},
) {
  return useSessionQuery({
    queryKey: userKeys.list(params),
    queryFn: ({ signal }) => UserClient.list(params, { signal }),
    // a screen that needs the users as they are now asks for 0; without one
    // the default of the application holds
    ...(staleTime === undefined ? {} : { staleTime }),
    placeholderData: (previous, previousQuery) => {
      const before = previousQuery?.queryKey[4] as UserListParams | undefined;
      return before && otherPageOfSameList(before, params)
        ? previous
        : undefined;
    },
  });
}

// One user by its address. A null address is the address of nothing: no
// request is sent.
export function useUser(href: string | null) {
  return useSessionQuery({
    queryKey: userKeys.detail(href ?? ''),
    queryFn: ({ signal }) => UserClient.retrieve(href as string, { signal }),
    enabled: href !== null,
  });
}

// The address of the signed-in user's own record as the session names it, or
// null while no user is signed in or when the session names no user address.
export function useOwnUserHref(): string | null {
  const { user } = useUserContext();

  return userHref(userUrlId(user?.pulp_href));
}

// The signed-in user's own record, read by the address the session names. The
// read is the one of that user's detail, so the two share what was read. With
// no address nothing is read and the result stays without data.
export function useOwnUser() {
  return useUser(useOwnUserHref());
}

// The server accepted the delete but the wait for the user to be gone failed:
// the user may or may not still exist. The cause is the failure of the wait.
export class UserRemovalUnconfirmedError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super('');
    this.name = 'UserRemovalUnconfirmedError';
    this.cause = cause;
  }
}

export interface DeleteUserRequest {
  // The address of the user to delete.
  href: string;
  // Told how the removal ended: null when the user is gone, the error
  // otherwise (a UserRemovalUnconfirmedError once the server had accepted the
  // delete). It is called once per removal, also after the screen that asked
  // has closed its dialog or gone, so the outcome is never lost. The screen
  // decides what the outcome means for what it shows.
  onDone?: (error: unknown) => void;
}

// Deletes a user and waits until the server no longer has it. One request is
// sent per call and it is never repeated by itself. Once the removal has
// settled, the user is forgotten and the lists are read again: whether the
// user was deleted or not, the rows may have changed.
export function useDeleteUser() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationKey: userKeys.removals,
    mutationFn: async ({ href }: DeleteUserRequest) => {
      await UserClient.remove(href);
      try {
        await UserClient.confirmRemoved(href);
      } catch (cause) {
        throw new UserRemovalUnconfirmedError(cause);
      }
    },
    // These run for every removal, whichever dialog started it and whether or
    // not that dialog is still there; callbacks given to `mutate` would be
    // dropped when another removal is started from the same dialog.
    onSuccess: (_data, { onDone }) => onDone?.(null),
    onError: (error, { onDone }) => onDone?.(error),
    onSettled: (_data, error, { href }) => {
      if (!error || error instanceof UserRemovalUnconfirmedError) {
        queryClient.removeQueries({ queryKey: userKeys.detail(href) });
      }
      return queryClient.invalidateQueries({ queryKey: userKeys.all });
    },
  });

  // Whether a removal of this user is under way, whichever component started
  // it. A dialog opened for another user is not affected by it.
  const isRemoving = (href: string) =>
    queryClient.isMutating({
      mutationKey: userKeys.removals,
      predicate: (candidate) =>
        (candidate.state.variables as DeleteUserRequest | undefined)?.href ===
        href,
    }) > 0;

  return { mutate: mutation.mutate, isRemoving };
}

// Creates a user. One request is sent per call and it is never repeated by
// itself; once it has succeeded the lists are read again.
export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (user: NewUser) => UserClient.create(user),
    onSuccess: () => {
      // the screen moves on at once; the lists catch up in the background
      void queryClient.invalidateQueries({ queryKey: userKeys.all });
    },
  });
}

export interface UpdateUserRequest {
  // The address of the user to change.
  href: string;
  // The fields to change; the others stay as they are.
  changes: PatchedUser;
}

// Changes a user. One request is sent per call and it is never repeated by
// itself. Once it has succeeded the user is what the server answered, so a
// screen that shows it never goes back to the values from before the save, and
// the user and the lists are read again.
export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ href, changes }: UpdateUserRequest) =>
      UserClient.update(href, changes),
    onSuccess: (updated, { href }) => {
      queryClient.setQueryData(userKeys.detail(href), updated);
      // the screen moves on at once; the lists catch up in the background
      void queryClient.invalidateQueries({ queryKey: userKeys.all });
    },
  });
}
