import type { PatchedUser } from '@pulp-ui/sdk/core/models/users/patched-user.zod';
import type { User as NewUser } from '@pulp-ui/sdk/core/models/users/user.zod';
import type { UsersListParams } from '@pulp-ui/sdk/core/models/users/users-list-params.zod';
import {
  usersCreate,
  usersDelete,
  usersList,
  usersPartialUpdate,
  usersRead,
} from '@pulp-ui/sdk/core/users';
import { parseResponse } from 'src/entities/response-shape';
import {
  DEFAULT_PAGE_SIZE,
  type User,
  type UserListParams,
  type UserPage,
  userPageSchema,
  userSchema,
} from './model';

const FILTERS = [
  'username__contains',
  'first_name__contains',
  'last_name__contains',
  'email__contains',
] as const;

// Turns the page, size and sort of the screen into what the server takes:
// an offset, a limit and an ordering. A filter that is not set is not sent.
function toRequestParams(params: UserListParams): UsersListParams {
  const limit = Math.max(1, Math.trunc(params.page_size ?? DEFAULT_PAGE_SIZE));
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const request: UsersListParams = { offset: (page - 1) * limit, limit };

  if (params.sort) {
    // The server rejects an ordering it does not know; that answer is shown
    // as a failed read.
    request.ordering = [params.sort] as UsersListParams['ordering'];
  }
  for (const filter of FILTERS) {
    if (params[filter]) {
      request[filter] = params[filter];
    }
  }

  return request;
}

// Lists one page of users. The options reach `fetch`, so an abort signal
// cancels the request. An answer that does not match the model is a
// ResponseShapeError.
async function list(
  params: UserListParams,
  options?: RequestInit,
): Promise<UserPage> {
  const data = await usersList(toRequestParams(params), options);
  return parseResponse(userPageSchema, data);
}

// Reads one user by its address.
async function retrieve(href: string, options?: RequestInit): Promise<User> {
  const data = await usersRead(href, undefined, options);
  return parseResponse(userSchema, data);
}

// Creates a user.
async function create(user: NewUser, options?: RequestInit): Promise<User> {
  const data = await usersCreate(user, options);
  return parseResponse(userSchema, data);
}

// Changes the fields of a user that are given; the others stay as they are.
async function update(
  href: string,
  changes: PatchedUser,
  options?: RequestInit,
): Promise<User> {
  const data = await usersPartialUpdate(href, changes, options);
  return parseResponse(userSchema, data);
}

// Deletes a user with one request. The server answers with no content.
async function remove(href: string, options?: RequestInit): Promise<void> {
  await usersDelete(href, options);
}

export const UserClient = { list, retrieve, create, update, remove };
