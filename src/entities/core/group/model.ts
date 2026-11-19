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

// A member of a group, as the dialog that lists who a deletion affects shows
// it. The name is required: an answer without it is not a member.
const groupMemberSchema = z.looseObject({
  pulp_href: z.string().nullish(),
  prn: z.string().nullish(),
  username: z.string(),
});

const groupMemberPageSchema = z.looseObject({
  count: z.number(),
  next: z.string().nullish(),
  previous: z.string().nullish(),
  results: z.array(groupMemberSchema),
});

type Group = z.infer<typeof groupSchema>;
type GroupPage = z.infer<typeof groupPageSchema>;
type GroupMemberPage = z.infer<typeof groupMemberPageSchema>;

// What a list of groups is asked for, in the terms of a screen: the page and
// its size, the column to sort by (a leading minus sorts down), and the text
// the name must contain (`name__contains` is case sensitive, as the search of
// a form needs; `name__icontains` is the filter of the group list).
interface GroupListParams {
  page?: number;
  page_size?: number;
  sort?: string;
  name__contains?: string;
  name__icontains?: string;
}

// What the name of a new group is sent as.
interface NewGroup {
  name: string;
}

const DEFAULT_PAGE_SIZE = 10;

export {
  DEFAULT_PAGE_SIZE,
  groupMemberPageSchema,
  groupPageSchema,
  groupSchema,
};
export type { Group, GroupListParams, GroupMemberPage, GroupPage, NewGroup };
