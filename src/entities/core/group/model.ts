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
type GroupMember = z.infer<typeof groupMemberSchema>;
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

// What the members of a group are shown by on a screen: the page and its size,
// the column to sort by (a leading minus sorts down; the username is the only
// column) and the text the username must contain.
interface GroupMemberListParams {
  page?: number;
  page_size?: number;
  sort?: string;
  username?: string;
}

// One page of members, cut from every member of the group. The members
// endpoint of the server lists and pages but does not filter or sort, so a
// screen that offers a filter and an order asks for all members once and cuts
// the page here. The count is the number of members that match the filter.
function pageOfMembers(
  members: GroupMember[],
  params: GroupMemberListParams,
): { count: number; results: GroupMember[] } {
  const text = params.username?.toLowerCase() ?? '';
  const matching = text
    ? members.filter((member) => member.username.toLowerCase().includes(text))
    : [...members];

  const down = params.sort === '-username';
  matching.sort((a, b) => {
    const order = a.username.localeCompare(b.username, undefined, {
      sensitivity: 'base',
    });
    return down ? -order : order;
  });

  const size = Math.max(1, Math.trunc(params.page_size ?? DEFAULT_PAGE_SIZE));
  const first = (Math.max(1, Math.trunc(params.page ?? 1)) - 1) * size;

  return {
    count: matching.length,
    results: matching.slice(first, first + size),
  };
}

const DEFAULT_PAGE_SIZE = 10;

export {
  DEFAULT_PAGE_SIZE,
  groupMemberPageSchema,
  groupPageSchema,
  groupSchema,
  pageOfMembers,
};
export type {
  Group,
  GroupListParams,
  GroupMember,
  GroupMemberListParams,
  GroupMemberPage,
  GroupPage,
  NewGroup,
};
