import { z } from 'zod';
import { pulpHrefSchema } from 'src/entities/href';

// A group a user belongs to, as the user screens show it. Pulp's user answer
// lists each group by name and address only; a numeric id is not part of it,
// so none is required. A field this schema does not name is kept as it came.
const userGroupSchema = z.looseObject({
  id: z.number().nullish(),
  name: z.string(),
  pulp_href: z.string().nullish(),
  prn: z.string().nullish(),
});

// The fields the user screens read, and nothing else. A field this schema does
// not name is kept as it came, so a later server version cannot break a page.
// The address and the username a row is shown by are required: an answer
// without them is not a user. Everything else the server may leave out or send
// as null.
//
// The generated response schema of the sdk is used for types only.
const userSchema = z.looseObject({
  pulp_href: pulpHrefSchema,
  prn: z.string().nullish(),
  id: z.number().nullish(),
  username: z.string(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  email: z.string().nullish(),
  is_staff: z.boolean().nullish(),
  is_active: z.boolean().nullish(),
  date_joined: z.string().nullish(),
  groups: z.array(userGroupSchema).nullish(),
});

const userPageSchema = z.looseObject({
  count: z.number(),
  next: z.string().nullish(),
  previous: z.string().nullish(),
  results: z.array(userSchema),
});

type User = z.infer<typeof userSchema>;
type UserPage = z.infer<typeof userPageSchema>;

// What a user list is asked for, in the terms of the address of the screen:
// the page and its size, the column to sort by (a leading minus sorts down),
// and the filters the list offers.
interface UserListParams {
  page?: number;
  page_size?: number;
  sort?: string;
  username__contains?: string;
  first_name__contains?: string;
  last_name__contains?: string;
  email__contains?: string;
}

const DEFAULT_PAGE_SIZE = 10;

export { DEFAULT_PAGE_SIZE, userPageSchema, userSchema };
export type { User, UserListParams, UserPage };
