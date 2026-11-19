import { z } from 'zod';
import { pulpHrefSchema } from 'src/entities/href';

// The fields the screens read of a group, and nothing else. A field this
// schema does not name is kept as it came, so a later server version cannot
// break a page. The address, the id and the name a group is chosen by are
// required: an answer without them is not a group.
//
// The generated response schema of the sdk is used for types only.
const groupSchema = z.looseObject({
  pulp_href: pulpHrefSchema,
  prn: z.string().nullish(),
  id: z.number(),
  name: z.string(),
});

const groupPageSchema = z.looseObject({
  count: z.number(),
  next: z.string().nullish(),
  previous: z.string().nullish(),
  results: z.array(groupSchema),
});

type Group = z.infer<typeof groupSchema>;
type GroupPage = z.infer<typeof groupPageSchema>;

// What a list of groups is asked for, in the terms of a screen: the page and
// its size, and the text the name must contain.
interface GroupListParams {
  page?: number;
  page_size?: number;
  name__contains?: string;
}

const DEFAULT_PAGE_SIZE = 10;

export { DEFAULT_PAGE_SIZE, groupPageSchema, groupSchema };
export type { Group, GroupListParams, GroupPage };
