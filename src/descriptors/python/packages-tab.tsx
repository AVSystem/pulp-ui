import { msg } from '@lingui/core/macro';
import type {
  PythonPackage,
  PythonRepository,
} from 'src/entities/python/model';
import { pythonPackage } from 'src/entities/python/package';
import type { TabDef } from 'src/framework/descriptor';
import {
  ContentList,
  type ContentListConfig,
} from 'src/framework/detail/content-tab';

// What the Packages tab lists of the latest version. One release usually has
// several files (an sdist and per-platform wheels), so the file name is what
// tells the rows apart. The server orders by the name; the other columns do not
// sort.
const PACKAGES: ContentListConfig<PythonPackage> = {
  entity: pythonPackage,
  fields: [
    'name',
    'version',
    'packagetype',
    'filename',
    'requires_python',
    'pulp_href',
  ],
  columns: [
    {
      id: 'name',
      label: msg`Name`,
      sortField: 'name',
      render: ({ name }) => name,
    },
    { id: 'version', label: msg`Version`, render: ({ version }) => version },
    {
      id: 'packagetype',
      label: msg`Type`,
      render: ({ packagetype }) => packagetype,
    },
    { id: 'filename', label: msg`File`, render: ({ filename }) => filename },
    {
      id: 'requires-python',
      label: msg`Requires Python`,
      render: ({ requires_python }) => requires_python || '---',
    },
  ],
  filters: [
    { param: 'name__contains', label: msg`Package name` },
    { param: 'packagetype', label: msg`Package type` },
    { param: 'requires_python__contains', label: msg`Requires Python` },
  ],
  title: msg`Packages`,
  errorTitle: msg`Packages could not be displayed.`,
  emptyTitle: msg`No packages in the latest version`,
  emptyDescription: msg`Sync this repository or upload packages to it.`,
  defaultPageSize: 20,
  defaultSort: 'name',
};

interface Props {
  repository: PythonRepository;
}

// The packages of a repository's latest version. A repository without a
// version holds none, and nothing is asked of the server.
export const PythonPackagesTab = ({ repository }: Props) => (
  <ContentList config={PACKAGES} version={repository.latest_version_href} />
);

// The Packages tab as the descriptor declares it among the repository's tabs.
export const packagesTab: TabDef<PythonRepository> = {
  id: 'packages',
  label: msg`Packages`,
  render: ({ repository }) => <PythonPackagesTab repository={repository} />,
};
