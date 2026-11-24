import { msg } from '@lingui/core/macro';
import type { SnippetDef, SnippetInput } from 'src/framework/descriptor';
import { UnsafeValueError } from 'src/framework/snippets/quote';
import { USER_PLACEHOLDER } from 'src/framework/snippets/urls';
import { shellQuote } from 'src/utilities/shell-quote';

// The tag the reader fills in.
const TAG = '<tag>';

// The host of the registry, with its port: the one the deployment names, or
// the one the page is served from.
function registryHost(input: SnippetInput): string {
  try {
    return new URL(input.entry?.read ?? input.origin).host;
  } catch {
    throw new UnsafeValueError('an address that is not valid');
  }
}

// The image the distribution holds under a tag: the registry host and the
// base path of the distribution.
const image = (input: SnippetInput): string =>
  `${registryHost(input)}/${input.basePath}:${TAG}`;

// The client configuration of a container distribution, which a registry
// serves: a container distribution always has the server's own guard, so every
// use needs an account. Every value is a quoted shell word.
export const containerSnippets: SnippetDef[] = [
  {
    id: 'login',
    label: msg`Log in`,
    language: 'shell',
    build: (input) =>
      `podman login --username ${shellQuote(USER_PLACEHOLDER)} ${shellQuote(registryHost(input))}`,
  },
  {
    id: 'pull',
    label: msg`Pull`,
    language: 'shell',
    build: (input) => `podman pull ${shellQuote(image(input))}`,
  },
  {
    id: 'push',
    label: msg`Push`,
    language: 'shell',
    build: (input) => `podman push ${shellQuote(image(input))}`,
  },
];
