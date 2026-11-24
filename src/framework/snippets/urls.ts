import type { SnippetInput } from '../descriptor';

// What stands in a snippet where a credential goes. A snippet never holds a
// secret: the reader replaces these with their own account and token.
export const USER_PLACEHOLDER = '<user>';
export const TOKEN_PLACEHOLDER = '<token>';

export const withSlash = (url: string): string =>
  url.endsWith('/') ? url : `${url}/`;

// The address without credentials it may carry in front of the host: a snippet
// never repeats them.
const withoutCredentials = (url: string): string =>
  url.replace(/^(https?:\/\/)[^/@]*@/, '$1');

// Where a client reads the distribution: the deployment's entry point when it
// names one, the address the server reports otherwise.
export const readUrl = ({ entry, url }: SnippetInput): string =>
  withSlash(withoutCredentials(entry?.read ?? url));

// Where a client writes, when the deployment names a write address.
export const writeUrl = ({ entry }: SnippetInput): string | null =>
  entry?.write ? withoutCredentials(entry.write) : null;

// The address with the credential placeholders written in front of the host,
// the form pip and other clients read. Credentials that the address already
// carries are replaced, never kept.
export const withCredentials = (url: string): string =>
  url.replace(
    /^(https?:\/\/)(?:[^/@]*@)?/,
    `$1${USER_PLACEHOLDER}:${TOKEN_PLACEHOLDER}@`,
  );
