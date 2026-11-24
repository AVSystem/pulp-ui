import { msg, t } from '@lingui/core/macro';
import { PulpCodeBlock } from 'src/components';
import { debDistribution } from 'src/entities/deb/distribution';
import type { DebRemote, DebRepository } from 'src/entities/deb/model';
import { debPublication } from 'src/entities/deb/publication';
import { debRemote } from 'src/entities/deb/remote';
import { debRepository } from 'src/entities/deb/repository';
import type { RemoteBase } from 'src/entities/plugin/model';
import type {
  ColumnDef,
  DetailRow,
  FieldDef,
  PluginDescriptor,
} from 'src/framework/descriptor';
import { distributionsTab } from 'src/framework/detail/distributions-tab';
import { versionsTab } from 'src/framework/detail/versions-tab';
import {
  POLICY_ROW,
  REMOTE_FILTERS,
  remoteColumns,
} from 'src/framework/remote-columns';
import {
  REPOSITORY_FILTERS,
  repositoryColumns,
} from 'src/framework/repository-columns';
import { shellQuote } from 'src/utilities/shell-quote';

// What a deb remote holds beyond what every remote has, read from the loose
// shape of a remote the generic screens pass around.
const aptOf = (remote: RemoteBase) => remote as DebRemote;

const DISTRIBUTIONS_COLUMN: ColumnDef<RemoteBase> = {
  id: 'distributions',
  label: msg`Distributions`,
  fields: ['distributions'],
  render: (remote) => aptOf(remote).distributions || '---',
};

const enabled = (value: boolean | null | undefined) =>
  value ? t`Enabled` : t`Disabled`;

// The apt rows of a remote's Details: what it syncs, what else it takes and the
// key that signed the release. The suites are required by the server, the
// components and architectures default to everything the release offers.
const REMOTE_ROWS: DetailRow<RemoteBase>[] = [
  POLICY_ROW,
  {
    id: 'distributions',
    label: msg`Distributions`,
    render: (remote) => aptOf(remote).distributions || t`None`,
  },
  {
    id: 'components',
    label: msg`Components`,
    render: (remote) => aptOf(remote).components || t`All`,
  },
  {
    id: 'architectures',
    label: msg`Architectures`,
    render: (remote) => aptOf(remote).architectures || t`All`,
  },
  {
    id: 'sync-sources',
    label: msg`Sync sources`,
    render: (remote) => enabled(aptOf(remote).sync_sources),
  },
  {
    id: 'sync-udebs',
    label: msg`Sync installer packages`,
    render: (remote) => enabled(aptOf(remote).sync_udebs),
  },
  {
    id: 'sync-installer',
    label: msg`Sync installer files`,
    render: (remote) => enabled(aptOf(remote).sync_installer),
  },
  {
    id: 'gpgkey',
    label: msg`GPG key`,
    render: (remote) =>
      aptOf(remote).gpgkey ? (
        <PulpCodeBlock
          code={aptOf(remote).gpgkey as string}
          filename={`${remote.name}-gpgkey`}
        />
      ) : (
        t`None`
      ),
  },
];

// The apt fields of a remote's form, drawn after the download policy. The
// suites are required: a remote with none to sync is refused rather than
// syncing everything. The key is a text that is typed, pasted or taken from a
// file, as a certificate is.
const REMOTE_FIELDS: FieldDef[] = [
  {
    name: 'distributions',
    label: msg`Distributions`,
    kind: 'text',
    required: true,
    help: msg`Whitespace separated list of distributions (also known as suites) to sync, for example "bookworm bookworm-updates".`,
  },
  {
    name: 'components',
    label: msg`Components`,
    kind: 'text',
    help: msg`Whitespace separated list of components to sync, for example "main contrib". If none are supplied, all that are available will be synchronized.`,
  },
  {
    name: 'architectures',
    label: msg`Architectures`,
    kind: 'text',
    help: msg`Whitespace separated list of architectures to sync, for example "amd64 arm64". If none are supplied, all that are available will be synchronized.`,
  },
  {
    name: 'gpgkey',
    label: msg`GPG key`,
    kind: 'certificate',
    help: msg`An armoured public key. When set, the signature on the upstream Release file is verified on every sync, which is what makes syncing over plain HTTP safe.`,
  },
  {
    name: 'sync_sources',
    label: msg`Sync sources`,
    kind: 'boolean',
    boxLabel: msg`Source packages will be synchronized`,
  },
  {
    name: 'sync_udebs',
    label: msg`Sync installer packages`,
    kind: 'boolean',
    boxLabel: msg`Installer packages will be synchronized`,
  },
  {
    name: 'sync_installer',
    label: msg`Sync installer files`,
    kind: 'boolean',
    boxLabel: msg`Installer files will be synchronized`,
  },
];

// The remote list: the name and the URL, then the suites each remote syncs,
// then what every remote list shows.
const [NAME_COLUMN, URL_COLUMN, ...OTHER_COLUMNS] = remoteColumns('deb', {
  policy: true,
});

// The deb plugin's repositories and remotes as the framework reads them. The
// descriptor and what it imports are one chunk that loads when a deb screen is
// first shown.
const descriptor: PluginDescriptor<DebRepository> = {
  repository: {
    entity: debRepository,
    detailRows: [
      {
        id: 'retain-repo-versions',
        label: msg`Retained version count`,
        render: (repository) => repository.retain_repo_versions ?? t`All`,
      },
      {
        id: 'autopublish',
        label: msg`Autopublish`,
        render: (repository) => enabled(repository.autopublish),
      },
      {
        id: 'publish-upstream-release-fields',
        label: msg`Publish upstream release fields`,
        render: (repository) =>
          enabled(repository.publish_upstream_release_fields),
      },
    ],
    fields: [
      {
        name: 'autopublish',
        label: msg`Autopublish`,
        kind: 'boolean',
        boxLabel: msg`Publish new versions automatically`,
        help: msg`Create a publication for every new repository version, so distributions pointing at this repository always serve the latest content.`,
      },
      {
        name: 'publish_upstream_release_fields',
        label: msg`Publish upstream release fields`,
        kind: 'boolean',
        boxLabel: msg`Publish the release fields of the upstream repository`,
        help: msg`Take the version, origin, label and description of the Release file from the upstream repository that was synced, instead of values of Pulp's own.`,
      },
    ],
    // A new repository does not publish by itself and publishes the upstream
    // release fields, which is what the server does when it is told nothing.
    createDefaults: {
      autopublish: false,
      publish_upstream_release_fields: true,
    },
    tabs: [versionsTab<DebRepository>(), distributionsTab<DebRepository>()],
    sync: {
      taskName: 'pulp_deb.app.tasks.synchronizing.synchronize',
      options: [
        {
          name: 'mirror',
          label: msg`Mirror`,
          kind: 'boolean',
          boxLabel: msg`Content not present in remote repository will be removed from the local repository`,
          help: msg`If selected, all content that is not present in the remote repository will be removed from the local repository; otherwise, sync will add missing content.`,
          // A mirror sync deletes the local content the remote no longer has,
          // so it is a choice to opt into and never starts on.
          initial: () => false,
        },
        {
          name: 'optimize',
          label: msg`Optimize`,
          kind: 'boolean',
          boxLabel: msg`Only perform the sync if changes are reported by the remote server.`,
          help: msg`Only perform the sync if changes are reported by the remote server. To force a sync to happen, deselect this option.`,
          initial: () => true,
        },
      ],
    },
    // A remote needs the suites to sync, which only the user knows, so the
    // command leaves them to be filled in. It is pasted into a terminal, so the
    // name and the URL are quoted as shell words: a repository name is free
    // text.
    snippet: {
      label: msg`CLI configuration`,
      build: ({ name, url }) =>
        `pulp deb remote create --name ${shellQuote(name)} --url ${shellQuote(url)} --distributions '<suite>'`,
    },
    filters: REPOSITORY_FILTERS,
    columns: repositoryColumns<DebRepository>('deb'),
  },
  remote: {
    entity: debRemote,
    policy: true,
    columns: [NAME_COLUMN, URL_COLUMN, DISTRIBUTIONS_COLUMN, ...OTHER_COLUMNS],
    filters: REMOTE_FILTERS,
    detailRows: REMOTE_ROWS,
    fields: REMOTE_FIELDS,
  },
  distribution: { entity: debDistribution },
  publication: {
    entity: debPublication,
    servesFromPublication: true,
    taskName: 'pulp_deb.app.tasks.publishing.publish',
    // The two modes are what the server uses when it is told nothing: it
    // refuses a publication that has neither.
    options: [
      {
        name: 'simple',
        label: msg`Simple publishing`,
        kind: 'boolean',
        boxLabel: msg`Put every package in one release component`,
        help: msg`Publish a flat layout where all packages are in a single release component.`,
        initial: () => false,
      },
      {
        name: 'structured',
        label: msg`Structured publishing`,
        kind: 'boolean',
        boxLabel: msg`Publish the release components and architectures of the repository`,
        help: msg`Publish the release components and architectures that the packages of the repository declare. At least one of the two modes stays on.`,
        initial: () => true,
      },
    ],
    // Turning one mode off while the other is off turns the other on, so the
    // server is never sent a publication with neither.
    adjust: (values, changed) =>
      values.simple === false && values.structured === false
        ? { ...values, [changed === 'simple' ? 'structured' : 'simple']: true }
        : values,
  },
};

export default descriptor;
