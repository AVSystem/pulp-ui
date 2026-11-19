import { z } from 'zod';
import { pulpHrefSchema } from 'src/entities/href';

// A role a group holds, as the roles tab of a group shows it. The address and
// the name of the role are required: an answer without them is not a group
// role. Everything else the server may leave out or send as null. A field this
// schema does not name is kept as it came, so a later server version cannot
// break a page.
//
// The generated response schema of the sdk is used for types only.
const groupRoleSchema = z.looseObject({
  pulp_href: pulpHrefSchema,
  prn: z.string().nullish(),
  role: z.string(),
  description: z.string().nullish(),
  permissions: z.array(z.string()).nullish(),
  content_object: z.string().nullish(),
  pulp_created: z.string().nullish(),
});

const groupRolePageSchema = z.looseObject({
  count: z.number(),
  next: z.string().nullish(),
  previous: z.string().nullish(),
  results: z.array(groupRoleSchema),
});

type GroupRole = z.infer<typeof groupRoleSchema>;
type GroupRolePage = z.infer<typeof groupRolePageSchema>;

// What the roles of a group are asked for, in the terms of the screen: the page
// and its size, the column to sort by (a leading minus sorts down) and the text
// the role name must contain, whatever its case.
interface GroupRoleListParams {
  page?: number;
  page_size?: number;
  sort?: string;
  role__icontains?: string;
}

const DEFAULT_PAGE_SIZE = 10;

export { DEFAULT_PAGE_SIZE, groupRolePageSchema, groupRoleSchema };
export type { GroupRole, GroupRoleListParams, GroupRolePage };
