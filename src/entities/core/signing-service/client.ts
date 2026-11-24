import { signingServicesList } from '@pulp-ui/sdk/core/signing-services';
import { type Page } from 'src/entities/plugin/model';
import { asParams, toListRequest } from 'src/entities/plugin/request';
import { parseResponse } from 'src/entities/response-shape';
import {
  type SigningService,
  type SigningServiceListParams,
  signingServicePageSchema,
} from './model';

// The fields a page is asked for: what the screen shows and nothing more, so
// the script of a service never reaches the browser.
const FIELDS = [
  'pulp_href',
  'name',
  'pubkey_fingerprint',
  'public_key',
  'pulp_created',
];

// One page of the signing services. A failure of the read is thrown for the
// screen to show; it is never turned into an empty page.
async function list(
  params: SigningServiceListParams,
  options?: RequestInit,
): Promise<Page<SigningService>> {
  const data = await signingServicesList(
    asParams<Parameters<typeof signingServicesList>[0]>({
      ...toListRequest(params, ['name']),
      fields: FIELDS,
    }),
    options,
  );

  return parseResponse(signingServicePageSchema, data);
}

export const SigningServiceClient = { list };
