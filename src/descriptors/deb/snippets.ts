import { msg } from '@lingui/core/macro';
import type { SnippetDef, SnippetInput } from 'src/framework/descriptor';
import {
  iniValue,
  safeIdentifier,
  urlValue,
} from 'src/framework/snippets/quote';
import {
  TOKEN_PLACEHOLDER,
  USER_PLACEHOLDER,
  readUrl,
} from 'src/framework/snippets/urls';
import { shellQuote } from 'src/utilities/shell-quote';

// The name of the files a distribution's configuration goes into: the
// distribution's name reduced to what is safe in a file name.
const stemOf = ({ name }: SnippetInput): string => safeIdentifier(name);

// Where apt keeps the signing keys of third party repositories.
const keyringOf = (input: SnippetInput): string =>
  `/etc/apt/keyrings/${stemOf(input)}.asc`;

// The suite and components the deployment names for the repository; the reader
// fills in the ones it does not.
const suiteOf = ({ entry }: SnippetInput): string =>
  entry?.suite ? iniValue(entry.suite) : '<suite>';

const componentsOf = ({ entry }: SnippetInput): string =>
  entry?.components?.length
    ? entry.components.map(iniValue).join(' ')
    : '<component>';

// The client configuration of a deb distribution. The files are line-oriented,
// so a value with a line break is refused, and every address is written with
// whitespace encoded.
export const debSnippets: SnippetDef[] = [
  {
    id: 'sources',
    label: msg`APT sources`,
    language: 'ini',
    build: (input) =>
      [
        `# /etc/apt/sources.list.d/${stemOf(input)}.sources`,
        'Types: deb',
        `URIs: ${urlValue(readUrl(input))}`,
        `Suites: ${suiteOf(input)}`,
        `Components: ${componentsOf(input)}`,
        ...(input.entry?.signingKey ? [`Signed-By: ${keyringOf(input)}`] : []),
      ].join('\n'),
  },
  // The key that signs the repository is published at the address the
  // deployment names.
  {
    id: 'signing-key',
    label: msg`Signing key`,
    language: 'shell',
    when: ({ entry }) => Boolean(entry?.signingKey),
    build: (input) =>
      `sudo curl -fsSL --create-dirs -o ${shellQuote(keyringOf(input))} ${shellQuote(input.entry?.signingKey ?? '')}`,
  },
  // apt reads credentials for a host and path from auth.conf.d, never from the
  // sources entry.
  {
    id: 'auth',
    label: msg`APT credentials`,
    language: 'text',
    when: ({ guarded }) => guarded,
    build: (input) =>
      [
        `# /etc/apt/auth.conf.d/${stemOf(input)}.conf`,
        `machine ${urlValue(
          readUrl(input)
            .replace(/^https?:\/\//, '')
            .replace(/\/$/, ''),
        )} login ${USER_PLACEHOLDER} password ${TOKEN_PLACEHOLDER}`,
      ].join('\n'),
  },
  // A remote needs the suites to sync, which only the user knows unless the
  // deployment names them.
  {
    id: 'pulp-cli',
    label: msg`CLI configuration`,
    language: 'shell',
    build: (input) =>
      `pulp deb remote create --name ${shellQuote(input.repositoryName ?? input.name)} --url ${shellQuote(readUrl(input))} --distributions ${shellQuote(input.entry?.suite ?? '<suite>')}`,
  },
];
