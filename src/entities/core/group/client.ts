import { groupsList } from '@pulp-ui/sdk/core/groups';
import type { GroupsListParams } from '@pulp-ui/sdk/core/models/groups/groups-list-params.zod';
import { parseResponse } from 'src/entities/response-shape';
import {
  DEFAULT_PAGE_SIZE,
  type GroupListParams,
  type GroupPage,
  groupPageSchema,
} from './model';

// Turns the page and size of the screen into what the server takes: an offset
// and a limit. A name filter that is empty is not sent.
function toRequestParams(params: GroupListParams): GroupsListParams {
  const limit = Math.max(1, Math.trunc(params.page_size ?? DEFAULT_PAGE_SIZE));
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const request: GroupsListParams = { offset: (page - 1) * limit, limit };

  if (params.name__contains) {
    request.name__contains = params.name__contains;
  }

  return request;
}

// Lists one page of groups. The options reach `fetch`, so an abort signal
// cancels the request. An answer that does not match the model is a
// ResponseShapeError.
async function list(
  params: GroupListParams,
  options?: RequestInit,
): Promise<GroupPage> {
  const data = await groupsList(toRequestParams(params), options);
  return parseResponse(groupPageSchema, data);
}

export const GroupClient = { list };
