import { t } from '@lingui/core/macro';
import { Link } from 'react-router';
import {
  DateComponent,
  Details,
  EmptyStateCustom,
  ListErrorState,
  LoadingSpinner,
} from 'src/components';
import { versionNumberOf } from 'src/entities/href';
import type { RepositoryBase } from 'src/entities/plugin/model';
import { useRepositoryVersion } from 'src/entities/plugin/queries';
import {
  isSessionEnd,
  requestErrorDescription,
} from 'src/utilities/request-error';
import { type PluginDescriptor, repositoryOf } from '../descriptor';
import type { FrameworkPlugin } from '../manifest';
import { versionPath } from '../route-patterns';
import { VersionContent } from './version-content';

interface Props {
  plugin: FrameworkPlugin;
  descriptor: PluginDescriptor;
  repository: RepositoryBase;
  number: number;
}

// One version of a repository, found by the number its address names: when it
// was made, what it added to the version before it, what it removed, the
// content it holds and the version it was made from. The number is only ever
// the value of a filter of the repository's versions list.
export const VersionDetail = ({
  plugin,
  descriptor,
  repository,
  number,
}: Props) => {
  const query = useRepositoryVersion(
    repositoryOf(descriptor).entity,
    repository.pulp_href,
    number,
  );
  const version = query.data;

  if (version === null) {
    return (
      <EmptyStateCustom
        title={t`Repository version not found`}
        description={t`This repository has no version ${number}.`}
      />
    );
  }
  if (!version) {
    // A session that ended keeps the spinner: the sign-in dialog explains it
    // and the read runs again afterwards.
    return query.isError && !isSessionEnd(query.error) && !query.isFetching ? (
      <ListErrorState
        title={t`Repository version could not be displayed.`}
        message={requestErrorDescription(query.error)}
        onRetry={() => query.refetch()}
      />
    ) : (
      <LoadingSpinner />
    );
  }

  const base = versionNumberOf(version.base_version);

  return (
    <div data-cy='VersionDetail'>
      <Details
        fields={[
          { label: t`Version number`, value: version.number },
          {
            label: t`Created date`,
            value: <DateComponent date={version.pulp_created ?? ''} />,
          },
          {
            label: t`Base version`,
            value:
              base === null ? (
                t`None`
              ) : (
                <Link to={versionPath(plugin, repository.name, base)}>
                  {base}
                </Link>
              ),
          },
        ]}
      />
      <VersionContent descriptor={descriptor} version={version} />
    </div>
  );
};
