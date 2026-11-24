import { msg } from '@lingui/core/macro';
import type { SnippetDef } from 'src/framework/descriptor';
import { readUrl } from 'src/framework/snippets/urls';
import { shellQuote } from 'src/utilities/shell-quote';

export const pythonSnippets: SnippetDef[] = [
  // pip looks for packages in the simple index under the distribution's
  // address. The address is quoted as a shell word; the package name is left
  // for the reader to fill in.
  {
    id: 'pip',
    label: msg`Install with pip`,
    language: 'shell',
    build: (input) =>
      `pip install --index-url ${shellQuote(`${readUrl(input)}simple/`)} <package>`,
  },
];
