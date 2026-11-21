import { msg } from '@lingui/core/macro';
import type { FieldDef, PluginDescriptor } from '../descriptor';
import { POLICY_OPTIONS } from '../remote-columns';
import { NAME_FIELD } from './repository-fields';

// The name of a remote in the form; it is shown on an edit and never sent.
export { NAME_FIELD };

// The field that holds the address a remote syncs from.
export const URL_FIELD = 'url';

// What a new remote's form holds before the user touches it, for the fields
// the plugin's form has: a new remote fetches content when a client asks for it
// instead of downloading a whole upstream at the first sync, and checks the TLS
// certificate of the server.
export const REMOTE_CREATE_DEFAULTS: Record<string, unknown> = {
  policy: 'on_demand',
  tls_validation: true,
};

// The server asks for a trailing slash on the address of a remote whose
// address has no query, and turns it down otherwise. The trivial case is fixed
// for the user.
export function withTrailingSlash(url: string): string {
  return url !== '' && !url.includes('?') && !url.endsWith('/')
    ? `${url}/`
    : url;
}

// The fields of a remote's form: the ones every remote has, the ones the plugin
// adds, the labels of a new remote and then the advanced options. An edit has
// no labels field: the labels of an existing remote are edited on its detail,
// where each change is its own request. The name is part of both; the edit
// shows it and never sends it.
export function remoteFields(
  descriptor: PluginDescriptor,
  mode: 'create' | 'edit',
): FieldDef[] {
  const { fields = [], policy = false } = descriptor.remote ?? {};

  return [
    { name: NAME_FIELD, label: msg`Name`, kind: 'text', required: true },
    {
      name: URL_FIELD,
      label: msg`URL`,
      kind: 'url',
      required: true,
      help: msg`The URL of an external content source.`,
    },
    ...(policy
      ? [
          {
            name: 'policy',
            label: msg`Download policy`,
            kind: 'select' as const,
            options: POLICY_OPTIONS,
            help: msg`Immediate downloads all content during sync and is required when the remote will not stay reachable. On demand syncs metadata only and downloads each item the first time a client requests it. Streamed passes content through to clients without storing it.`,
            hint: msg`On demand fetches content when a client asks for it. Immediate downloads everything at sync. Streamed passes content through without storing it.`,
          },
        ]
      : []),
    ...fields,
    {
      name: 'username',
      label: msg`Username`,
      kind: 'text',
      secret: true,
      help: msg`The username to be used for authentication when syncing.`,
    },
    {
      name: 'password',
      label: msg`Password`,
      kind: 'secret',
      help: msg`The password to be used for authentication when syncing.`,
    },
    ...(mode === 'create'
      ? [
          {
            name: 'pulp_labels',
            label: msg`Labels`,
            kind: 'labels' as const,
            help: msg`Labels are pairs of a key and an optional value. Filters and scripts use them to find remotes.`,
          },
        ]
      : []),
    {
      name: 'proxy_url',
      label: msg`Proxy URL`,
      kind: 'text',
      advanced: true,
      help: msg`The URL of a proxy the downloads go through, for example http://proxy.example:3128.`,
    },
    {
      name: 'proxy_username',
      label: msg`Proxy username`,
      kind: 'text',
      secret: true,
      advanced: true,
    },
    {
      name: 'proxy_password',
      label: msg`Proxy password`,
      kind: 'secret',
      advanced: true,
    },
    {
      name: 'tls_validation',
      label: msg`TLS validation`,
      kind: 'boolean',
      advanced: true,
      boxLabel: msg`Validate the TLS certificate of the server`,
      help: msg`If selected, TLS peer validation must be performed.`,
    },
    {
      name: 'client_key',
      label: msg`Client key`,
      kind: 'certificate',
      secret: true,
      advanced: true,
      help: msg`A PEM encoded private key used for authentication.`,
    },
    {
      name: 'client_cert',
      label: msg`Client certificate`,
      kind: 'certificate',
      advanced: true,
      help: msg`A PEM encoded client certificate used for authentication.`,
    },
    {
      name: 'ca_cert',
      label: msg`CA certificate`,
      kind: 'certificate',
      advanced: true,
      help: msg`A PEM encoded CA certificate used to check the certificate of the server.`,
    },
    {
      name: 'download_concurrency',
      label: msg`Download concurrency`,
      kind: 'integer',
      advanced: true,
      min: 1,
      placeholder: '10',
      help: msg`Total number of simultaneous connections.`,
      hint: msg`Leave empty to use the default of 10 connections.`,
    },
    {
      name: 'rate_limit',
      label: msg`Rate limit`,
      kind: 'integer',
      advanced: true,
      help: msg`Limits total download rate in requests per second.`,
    },
    {
      name: 'total_timeout',
      label: msg`Total timeout`,
      kind: 'decimal',
      advanced: true,
      min: 0,
      help: msg`Total time in seconds allowed for one download, including connecting and reading. Decimals such as 2.5 are accepted.`,
      hint: msg`Seconds. Leave empty to use the server default.`,
    },
    {
      name: 'max_retries',
      label: msg`Retries`,
      kind: 'integer',
      advanced: true,
      min: 0,
      help: msg`How many times a failed download is tried again before the sync gives up.`,
      hint: msg`A whole number. Leave empty to use the server default.`,
    },
  ];
}
