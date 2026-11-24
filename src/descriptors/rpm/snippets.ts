import { msg } from '@lingui/core/macro';
import type { SnippetDef } from 'src/framework/descriptor';
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

// The client configuration of an rpm distribution. The repo file is
// line-oriented: the section name is reduced to what is safe in a header, a
// value with a line break is refused, and addresses are written with
// whitespace and dollar signs (which dnf reads as variables) encoded.
export const rpmSnippets: SnippetDef[] = [
  {
    id: 'repo-file',
    label: msg`Repository file`,
    language: 'ini',
    build: (input) => {
      const stem = safeIdentifier(input.name);

      return [
        `# /etc/yum.repos.d/${stem}.repo`,
        `[${stem}]`,
        `name=${iniValue(input.name)}`,
        `baseurl=${urlValue(readUrl(input))}`,
        'enabled=1',
        // Signatures can be checked only against a key the deployment names.
        ...(input.entry?.signingKey
          ? [
              'gpgcheck=1',
              'repo_gpgcheck=1',
              `gpgkey=${urlValue(input.entry.signingKey)}`,
            ]
          : []),
        ...(input.guarded
          ? [`username=${USER_PLACEHOLDER}`, `password=${TOKEN_PLACEHOLDER}`]
          : []),
      ].join('\n');
    },
  },
  {
    id: 'pulp-cli',
    label: msg`CLI configuration`,
    language: 'shell',
    build: (input) =>
      `pulp rpm remote create --name ${shellQuote(input.repositoryName ?? input.name)} --url ${shellQuote(readUrl(input))}`,
  },
];
