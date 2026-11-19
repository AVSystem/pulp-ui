import type { RolesListParams } from '@pulp-ui/sdk/core/models/roles/roles-list-params.zod';
import { rolesList } from '@pulp-ui/sdk/core/roles';
import { parseResponse } from 'src/entities/response-shape';
import { config } from 'src/ui-config';
import {
  DEFAULT_PAGE_SIZE,
  type RoleListParams,
  type RolePage,
  rolePageSchema,
} from './model';

// Turns the page, size and sort of the screen into what the server takes: an
// offset, a limit and an ordering. A filter that is not set is not sent. The
// kind of object becomes the address of its endpoint, which the server matches
// against the permissions of each role.
function toRequestParams(params: RoleListParams): RolesListParams {
  const limit = Math.max(1, Math.trunc(params.page_size ?? DEFAULT_PAGE_SIZE));
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const request: RolesListParams = { offset: (page - 1) * limit, limit };

  if (params.sort) {
    // The server rejects an ordering it does not know; that answer is shown
    // as a failed read.
    request.ordering = [params.sort] as RolesListParams['ordering'];
  }
  if (params.name__icontains) {
    request.name__icontains = params.name__icontains;
  }
  if (params.object_type) {
    request.for_object_type = `${config.API_BASE_PATH}${params.object_type}/`;
  }

  return request;
}

// Lists one page of roles. The options reach `fetch`, so an abort signal
// cancels the request. An answer that does not match the model is a
// ResponseShapeError.
async function list(
  params: RoleListParams,
  options?: RequestInit,
): Promise<RolePage> {
  const data = await rolesList(toRequestParams(params), options);
  return parseResponse(rolePageSchema, data);
}

export const RoleClient = { list };
