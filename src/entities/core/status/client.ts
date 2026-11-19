import { statusRead } from '@pulp-ui/sdk/core/status';
import { parseResponse } from 'src/entities/response-shape';
import { type Status, statusSchema } from './model';

// Reads the status. The options reach `fetch`, so an abort signal cancels the
// request. An answer that does not match the model is a ResponseShapeError.
async function retrieve(options?: RequestInit): Promise<Status> {
  const data = await statusRead(undefined, options);
  return parseResponse(statusSchema, data);
}

export const StatusClient = { retrieve };
