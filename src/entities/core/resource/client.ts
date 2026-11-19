import { pulpFetch } from '@pulp-ui/sdk/mutator/pulp-fetch';
import { parseResponse } from 'src/entities/response-shape';
import { type Resource, resourceSchema } from './model';

// Reads one resource by its address. The generated client has a read for each
// kind of object, and a task can reserve any of them, so the read goes through
// the transport all generated calls share: the same session rules and the same
// refusal of an address outside the API apply. The options reach `fetch`, so an
// abort signal cancels the request. An answer that does not match the model is
// a ResponseShapeError.
async function retrieve(
  href: string,
  options?: RequestInit,
): Promise<Resource> {
  const data = await pulpFetch<unknown>(href, { ...options, method: 'GET' });
  return parseResponse(resourceSchema, data);
}

export const ResourceClient = { retrieve };
