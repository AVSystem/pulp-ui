import { msg } from '@lingui/core/macro';
import type { SnippetDef, SnippetInput } from 'src/framework/descriptor';
import { urlValue } from 'src/framework/snippets/quote';
import {
  TOKEN_PLACEHOLDER,
  USER_PLACEHOLDER,
  readUrl,
  withCredentials,
  writeUrl,
} from 'src/framework/snippets/urls';
import { shellQuote } from 'src/utilities/shell-quote';

// The root of the distribution's python index: where the simple index and the
// upload endpoint sit below. A deployment may name the simple index itself as
// its read address, which is then taken back to its root; the address the
// server reports for a distribution is the root, whatever its base path is
// called.
const rootOf = (input: SnippetInput): string =>
  input.entry ? readUrl(input).replace(/\/simple\/$/, '/') : readUrl(input);

// pip looks for packages in the simple index under the root. A guarded
// distribution's address carries the credential placeholders before the host.
const indexOf = (input: SnippetInput): string => {
  const index = `${rootOf(input)}simple/`;

  return input.guarded ? withCredentials(index) : index;
};

// The client configuration of a python distribution. The command lines quote
// every value as a shell word, the pip.conf encodes the address for a
// line-oriented file. An upload always needs an account, whether or not the
// distribution is guarded.
export const pythonSnippets: SnippetDef[] = [
  {
    id: 'pip',
    label: msg`Install with pip`,
    language: 'shell',
    build: (input) =>
      `pip install --index-url ${shellQuote(indexOf(input))} <package>`,
  },
  {
    id: 'pip-conf',
    label: msg`pip.conf`,
    language: 'ini',
    build: (input) =>
      [
        '# ~/.config/pip/pip.conf',
        '[global]',
        `index-url = ${urlValue(indexOf(input))}`,
      ].join('\n'),
  },
  // The glob is left to the reader's shell.
  {
    id: 'twine',
    label: msg`Upload with twine`,
    language: 'shell',
    build: (input) =>
      `twine upload --repository-url ${shellQuote(writeUrl(input) ?? `${rootOf(input)}legacy/`)} --username ${shellQuote(USER_PLACEHOLDER)} --password ${shellQuote(TOKEN_PLACEHOLDER)} dist/*`,
  },
];
