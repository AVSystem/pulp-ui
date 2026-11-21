import { msg, t } from '@lingui/core/macro';
import type { RemoteBase } from 'src/entities/plugin/model';
import { pythonDistribution } from 'src/entities/python/distribution';
import type { PythonRemote, PythonRepository } from 'src/entities/python/model';
import { pythonRemote } from 'src/entities/python/remote';
import { pythonRepository } from 'src/entities/python/repository';
import type {
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
import { PythonDistributionEdit } from './distribution-edit';
import { packagesTab } from './packages-tab';

// What a python remote holds beyond what every remote has, read from the loose
// shape of a remote the generic screens pass around.
const pythonOf = (remote: RemoteBase) => remote as PythonRemote;

// The package types the server knows, as setuptools names them. The names are
// the values the server takes, so they are shown as they are.
const PACKAGE_TYPES = [
  { value: 'sdist', label: msg`sdist` },
  { value: 'bdist_wheel', label: msg`bdist_wheel` },
  { value: 'bdist_egg', label: msg`bdist_egg` },
  { value: 'bdist_dumb', label: msg`bdist_dumb` },
  { value: 'bdist_rpm', label: msg`bdist_rpm` },
  { value: 'bdist_msi', label: msg`bdist_msi` },
  { value: 'bdist_wininst', label: msg`bdist_wininst` },
  { value: 'bdist_dmg', label: msg`bdist_dmg` },
];

// The platforms whose packages a remote can leave out.
const PLATFORMS = [
  { value: 'windows', label: msg`windows` },
  { value: 'macos', label: msg`macos` },
  { value: 'freebsd', label: msg`freebsd` },
  { value: 'linux', label: msg`linux` },
];

// A list as a sentence: the items joined by commas, or what a missing list
// means.
const listed = (items: string[] | null | undefined, none: string) =>
  items?.length ? items.join(', ') : none;

// The rows of a remote's Details: the download policy and what the remote
// syncs. A list that is empty means no limit, so it reads as all or none, never
// as a blank.
const REMOTE_ROWS: DetailRow<RemoteBase>[] = [
  POLICY_ROW,
  {
    id: 'includes',
    label: msg`Includes`,
    render: (remote) => listed(pythonOf(remote).includes, t`All projects`),
  },
  {
    id: 'excludes',
    label: msg`Excludes`,
    render: (remote) => listed(pythonOf(remote).excludes, t`None`),
  },
  {
    id: 'prereleases',
    label: msg`Pre-releases`,
    render: (remote) =>
      pythonOf(remote).prereleases ? t`Included` : t`Excluded`,
  },
  {
    id: 'package-types',
    label: msg`Package types`,
    render: (remote) => listed(pythonOf(remote).package_types, t`All`),
  },
  {
    id: 'keep-latest-packages',
    label: msg`Latest versions kept per package`,
    // 0 is how the server says that every version of a package is kept
    render: (remote) => pythonOf(remote).keep_latest_packages || t`All`,
  },
  {
    id: 'exclude-platforms',
    label: msg`Excluded platforms`,
    render: (remote) => listed(pythonOf(remote).exclude_platforms, t`None`),
  },
  {
    id: 'provenance',
    label: msg`Provenance`,
    render: (remote) =>
      pythonOf(remote).provenance ? t`Synced` : t`Not synced`,
  },
  {
    id: 'vulnerabilities',
    label: msg`Vulnerability scan`,
    render: (remote) =>
      pythonOf(remote).vulnerabilities ? t`Enabled` : t`Disabled`,
  },
];

// The python fields of a remote's form, drawn after the download policy. A
// list of projects is typed one specifier to a line, and the package types and
// platforms are sets of boxes: both are empty to mean no limit.
const REMOTE_FIELDS: FieldDef[] = [
  {
    name: 'includes',
    label: msg`Includes`,
    kind: 'lines',
    placeholder: 'django>=4.2\nrequests',
    help: msg`Projects to sync, one specifier per line, for example "django>=4.2". Leave empty to sync every project the remote offers.`,
  },
  {
    name: 'excludes',
    label: msg`Excludes`,
    kind: 'lines',
    placeholder: 'django<4',
    help: msg`Projects to skip, one specifier per line, for example "django<4". Applied after includes.`,
  },
  {
    name: 'prereleases',
    label: msg`Pre-releases`,
    kind: 'boolean',
    boxLabel: msg`Include pre-release versions`,
    help: msg`Whether to include pre-release versions in the sync.`,
  },
  {
    name: 'package_types',
    label: msg`Package types`,
    kind: 'choices',
    options: PACKAGE_TYPES,
    help: msg`Package types to sync. Leave all unticked to sync every type.`,
  },
  {
    name: 'keep_latest_packages',
    label: msg`Latest versions kept per package`,
    kind: 'integer',
    // The server has no null for it: 0 keeps every version, so a blank field is
    // sent as 0.
    blankValue: 0,
    help: msg`How many of the newest versions of each package to sync, including pre-releases if those are synced. Leave blank to keep all versions.`,
  },
  {
    name: 'exclude_platforms',
    label: msg`Excluded platforms`,
    kind: 'choices',
    options: PLATFORMS,
    help: msg`Platforms whose packages should not be synced.`,
  },
  {
    name: 'provenance',
    label: msg`Provenance`,
    kind: 'boolean',
    boxLabel: msg`Sync package provenance`,
    help: msg`Whether to also sync the provenance attestations published for packages.`,
  },
  {
    name: 'vulnerabilities',
    label: msg`Vulnerability scan`,
    kind: 'boolean',
    boxLabel: msg`Scan new repository versions for vulnerabilities after a sync`,
    help: msg`Whether to scan the new repository version for vulnerabilities after a sync.`,
  },
];

// pip looks for packages in the simple index under the URL the server reports
// for the distribution. The URL is quoted as a shell word; the package name is
// left for the reader to fill in.
const pipInstallCommand = (url: string): string =>
  `pip install --index-url ${shellQuote(`${url.endsWith('/') ? url : `${url}/`}simple/`)} <package>`;

// The python plugin's repositories and remotes as the framework reads them. The
// descriptor and what it imports are one chunk that loads when a python screen
// is first shown.
const descriptor: PluginDescriptor<PythonRepository> = {
  repository: {
    entity: pythonRepository,
    detailRows: [
      {
        id: 'retain-repo-versions',
        label: msg`Retained version count`,
        render: (repository) => repository.retain_repo_versions ?? t`All`,
      },
      {
        id: 'allow-package-substitution',
        label: msg`Package substitution`,
        render: (repository) =>
          repository.allow_package_substitution === false
            ? t`Not allowed`
            : t`Allowed`,
      },
      {
        id: 'error-on-reject',
        label: msg`When packages are rejected`,
        render: (repository) =>
          repository.error_on_reject === false
            ? t`Skip them`
            : t`Fail the whole version`,
      },
    ],
    fields: [
      {
        name: 'allow_package_substitution',
        label: msg`Allow package substitution`,
        kind: 'boolean',
        boxLabel: msg`Allow same-filename packages with different contents`,
        help: msg`Allow replacing an existing package with one that has the same filename but a different checksum. When off, any new repository version that would cause such a substitution is rejected, whether from sync, upload or modify.`,
      },
      {
        name: 'error_on_reject',
        label: msg`Fail on rejected packages`,
        kind: 'boolean',
        boxLabel: msg`Fail the whole version if any package is rejected`,
        help: msg`When on, a rejected package fails the whole repository version and nothing is added. When off, rejected packages are skipped, the rest are added, and the skipped ones are listed in the task's progress report.`,
      },
    ],
    // A new repository allows substitution and fails a version that holds a
    // rejected package, which is what the server does when it is told nothing.
    createDefaults: {
      allow_package_substitution: true,
      error_on_reject: true,
    },
    tabs: [
      versionsTab<PythonRepository>(),
      distributionsTab<PythonRepository>(),
      packagesTab,
    ],
    sync: {
      taskName: 'pulp_python.app.tasks.sync.sync',
      // The python sync has no optimize option: only the mirror choice.
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
      ],
    },
    // The command is pasted into a terminal, so the address is quoted as a
    // shell word: a repository name is free text.
    snippet: {
      label: msg`Install with pip`,
      build: ({ url }) => pipInstallCommand(url),
    },
    filters: REPOSITORY_FILTERS,
    columns: repositoryColumns<PythonRepository>('python'),
  },
  remote: {
    entity: pythonRemote,
    policy: true,
    columns: remoteColumns('python', { policy: true }),
    filters: REMOTE_FILTERS,
    detailRows: REMOTE_ROWS,
    fields: REMOTE_FIELDS,
  },
  contentTypes: [{ id: 'python.package', label: msg`Packages` }],
  // A python distribution is served without a publication, so the descriptor
  // declares none. Its pull-through remote and upload permission can be
  // changed after it is made, by an account that may change distributions.
  distribution: {
    entity: pythonDistribution,
    edit: {
      permission: 'python.change_pythondistribution',
      label: msg`Edit distribution`,
      dialog: (props) => <PythonDistributionEdit {...props} />,
    },
  },
};

export default descriptor;
