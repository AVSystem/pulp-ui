import { msg } from '@lingui/core/macro';
import type { SnippetDef, SnippetInput } from 'src/framework/descriptor';
import { encodeBasePath } from 'src/framework/snippets/entry-points';
import { UnsafeValueError, npmrcUrl } from 'src/framework/snippets/quote';
import {
  TOKEN_PLACEHOLDER,
  USER_PLACEHOLDER,
  readUrl,
  withSlash,
  writeUrl,
} from 'src/framework/snippets/urls';
import { shellQuote } from 'src/utilities/shell-quote';

// Where a publish goes: the address the deployment names for it, or the
// publish endpoint of the distribution, which the server addresses by its base
// path.
const publishUrl = (input: SnippetInput): string =>
  withSlash(
    writeUrl(input) ?? `${input.origin}/npm/${encodeBasePath(input.basePath)}/`,
  );

// The key an npmrc file keys the credentials of a registry by: its address
// without the scheme.
function authKey(registry: string): string {
  try {
    const { host, pathname } = new URL(registry);

    return `//${host}${pathname}`;
  } catch {
    throw new UnsafeValueError('an address that is not valid');
  }
}

const BASE64 = '<base64>';

// The client configuration of an npm distribution. The registry is read from
// the distribution and published to its publish address; the credentials are
// one base64 line per address they are sent to, which the file cannot hold in
// any other form for an account with a password.
export const npmSnippets: SnippetDef[] = [
  {
    id: 'npmrc',
    label: msg`.npmrc`,
    language: 'ini',
    build: (input) => {
      const registry = npmrcUrl(readUrl(input));
      const publish = npmrcUrl(publishUrl(input));
      const keys = Array.from(
        new Set((input.guarded ? [registry, publish] : [publish]).map(authKey)),
      );

      return [
        '# ~/.npmrc',
        `registry=${registry}`,
        `# ${input.guarded ? '' : 'Needed to publish: '}${BASE64} is the base64 encoding of ${USER_PLACEHOLDER}:${TOKEN_PLACEHOLDER}`,
        ...keys.map((key) => `${key}:_auth=${BASE64}`),
      ].join('\n');
    },
  },
  {
    id: 'publish',
    label: msg`Publish with npm`,
    language: 'shell',
    build: (input) => `npm publish --registry ${shellQuote(publishUrl(input))}`,
  },
];
