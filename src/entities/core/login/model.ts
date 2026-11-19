import { z } from 'zod';
import { pulpHrefSchema } from 'src/entities/href';
import { basicAuthorization } from 'src/utilities/basic-authorization';

// The server accepts at most this many characters in a username; a longer one
// is refused before any request is sent.
const USERNAME_MAX_LENGTH = 150;

const loginDomainSchema = z.object({
  href: pulpHrefSchema,
  prn: z.string(),
  username: z.string(),
});

// The three fields of the answer the application reads, all required: a login
// answer without one of them cannot identify the account. Any other field of
// the answer is ignored. The generated schema of the sdk marks every field
// optional, so it serves for types only.
const loginResponseSchema = z.object({
  pulp_href: pulpHrefSchema,
  prn: z.string(),
  username: z.string(),
});

type Login = z.infer<typeof loginDomainSchema>;

const loginResponseCodec = z.codec(loginResponseSchema, loginDomainSchema, {
  decode: ({ pulp_href, prn, username }) => ({
    href: pulp_href,
    prn,
    username,
  }),
  encode: () => {
    throw new Error('LoginResponse is server-issued; encode is not supported.');
  },
});

const credentialsSchema = z.object({
  username: z
    .string()
    .refine((value) => !value.includes(':'), {
      error: 'username must not contain a colon.',
    })
    .max(USERNAME_MAX_LENGTH),
  password: z.string(),
});

type Credentials = z.infer<typeof credentialsSchema>;

const credentialsCodec = z.codec(z.string(), credentialsSchema, {
  decode: () => {
    throw new Error(
      'A Basic Auth header cannot be decoded back into user credentials.',
    );
  },
  encode: ({ username, password }) => basicAuthorization(username, password),
});

export { loginResponseCodec, credentialsCodec };
export type { Login, Credentials };
