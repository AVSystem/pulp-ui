import { msg } from '@lingui/core/macro';
import type { RpmPackage, RpmRepository } from 'src/entities/rpm/model';
import { rpmPackage } from 'src/entities/rpm/package';
import type { TabDef } from 'src/framework/descriptor';
import {
  ContentList,
  type ContentListConfig,
} from 'src/framework/detail/content-tab';

// epoch:version-release, with the epoch left out when it is 0, as rpm and dnf
// show it. The server sends the epoch as text, and a number is taken too.
export const evr = ({ epoch, version, release }: RpmPackage): string => {
  const prefix = epoch != null && String(epoch) !== '0' ? `${epoch}:` : '';

  return `${prefix}${version}${release ? `-${release}` : ''}`;
};

// What the Packages tab lists of the latest version: the name, the version, the
// architecture and the summary. The server orders by the name; the version is
// not ordered on its own, because a version is compared by epoch, version and
// release together.
const PACKAGES: ContentListConfig<RpmPackage> = {
  entity: rpmPackage,
  fields: [
    'name',
    'epoch',
    'version',
    'release',
    'arch',
    'summary',
    'pulp_href',
  ],
  columns: [
    {
      id: 'name',
      label: msg`Name`,
      sortField: 'name',
      render: ({ name }) => name,
    },
    { id: 'version', label: msg`Version`, render: evr },
    { id: 'arch', label: msg`Arch`, render: ({ arch }) => arch },
    { id: 'summary', label: msg`Summary`, render: ({ summary }) => summary },
  ],
  filters: [
    { param: 'name__contains', label: msg`Package name` },
    { param: 'arch', label: msg`Arch` },
  ],
  title: msg`Packages`,
  errorTitle: msg`Packages could not be displayed.`,
  emptyTitle: msg`No packages in the latest version`,
  emptyDescription: msg`Sync this repository or add packages to it.`,
  defaultPageSize: 20,
  defaultSort: 'name',
};

interface Props {
  repository: RpmRepository;
}

// The packages of a repository's latest version. A repository without a
// version holds none, and nothing is asked of the server.
export const RpmPackagesTab = ({ repository }: Props) => (
  <ContentList config={PACKAGES} version={repository.latest_version_href} />
);

// The Packages tab as the descriptor declares it among the repository's tabs.
export const packagesTab: TabDef<RpmRepository> = {
  id: 'packages',
  label: msg`Packages`,
  render: ({ repository }) => <RpmPackagesTab repository={repository} />,
};
