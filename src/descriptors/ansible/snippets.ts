import { msg } from '@lingui/core/macro';
import type { SnippetDef, SnippetInput } from 'src/framework/descriptor';
import { safeIdentifier, urlValue } from 'src/framework/snippets/quote';
import {
  TOKEN_PLACEHOLDER,
  USER_PLACEHOLDER,
  readUrl,
} from 'src/framework/snippets/urls';
import { shellQuote } from 'src/utilities/shell-quote';

// The name ansible.cfg gives the server: reduced to what a section name holds,
// so a name cannot close the section or start another.
const serverName = (input: SnippetInput): string => safeIdentifier(input.name);

// The client configuration of an ansible distribution. The collection source
// needs an account whether or not the distribution is guarded: the Galaxy API
// does not answer an anonymous client.
export const ansibleSnippets: SnippetDef[] = [
  {
    id: 'ansible-cfg',
    label: msg`ansible.cfg`,
    language: 'ini',
    build: (input) =>
      [
        '# ansible.cfg',
        '[galaxy]',
        `server_list = ${serverName(input)}`,
        '',
        `[galaxy_server.${serverName(input)}]`,
        `url = ${urlValue(readUrl(input))}`,
        `username = ${USER_PLACEHOLDER}`,
        `password = ${TOKEN_PLACEHOLDER}`,
      ].join('\n'),
  },
  // The server is the one the configuration above names, which holds the
  // account.
  {
    id: 'install',
    label: msg`Install a collection`,
    language: 'shell',
    build: (input) =>
      `ansible-galaxy collection install --server ${shellQuote(serverName(input))} <namespace.name>`,
  },
  {
    id: 'publish',
    label: msg`Publish a collection`,
    language: 'shell',
    build: (input) =>
      `ansible-galaxy collection publish <archive> --server ${shellQuote(serverName(input))}`,
  },
];
