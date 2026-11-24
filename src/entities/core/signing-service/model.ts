import { z } from 'zod';
import { pulpHrefSchema } from 'src/entities/href';
import { pageSchemaOf } from 'src/entities/plugin/model';

// What the signature keys screen reads of a signing service, and nothing else.
// The script a service runs to sign is never asked for and never shown. A field
// this schema does not name is kept as it came, so a later server version
// cannot break the screen; the address and the name are required, and the
// address is a same-origin path (pulpHrefSchema).
export const signingServiceSchema = z.looseObject({
  pulp_href: pulpHrefSchema,
  name: z.string(),
  pubkey_fingerprint: z.string().nullish(),
  public_key: z.string().nullish(),
  pulp_created: z.string().nullish(),
});

export const signingServicePageSchema = pageSchemaOf(signingServiceSchema);

export type SigningService = z.infer<typeof signingServiceSchema>;

// What a page of the list is asked for, in the terms of a screen. The server
// matches `name` exactly; it has no substring filter on signing services.
export interface SigningServiceListParams {
  page: number;
  page_size: number;
  sort: string;
  name?: string;
}
