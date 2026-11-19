import { z } from 'zod';
import { pulpHrefSchema } from 'src/entities/href';

// The fields the role screens read, and nothing else. A field this schema does
// not name is kept as it came, so a later server version cannot break a page.
// The address and the name a role is chosen by are required: an answer without
// them is not a role. Everything else the server may leave out or send as null.
//
// The generated response schema of the sdk is used for types only.
const roleSchema = z.looseObject({
  pulp_href: pulpHrefSchema,
  prn: z.string().nullish(),
  name: z.string(),
  description: z.string().nullish(),
  permissions: z.array(z.string()).nullish(),
  locked: z.boolean().nullish(),
  pulp_created: z.string().nullish(),
});

const rolePageSchema = z.looseObject({
  count: z.number(),
  next: z.string().nullish(),
  previous: z.string().nullish(),
  results: z.array(roleSchema),
});

type Role = z.infer<typeof roleSchema>;
type RolePage = z.infer<typeof rolePageSchema>;

// What a list of roles is asked for, in the terms of a screen: the page and its
// size, the column to sort by (a leading minus sorts down), the text the name
// must contain whatever its case, and the kind of object the roles are for
// (the path of its endpoint below the API root, for example
// `repositories/ansible/ansible`), which keeps only the roles whose
// permissions fit that kind of object.
interface RoleListParams {
  page?: number;
  page_size?: number;
  sort?: string;
  name__icontains?: string;
  object_type?: string;
}

const DEFAULT_PAGE_SIZE = 10;

export { DEFAULT_PAGE_SIZE, rolePageSchema, roleSchema };
export type { Role, RoleListParams, RolePage };
