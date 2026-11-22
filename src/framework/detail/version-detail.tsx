import { t } from '@lingui/core/macro';
import { Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { Link } from 'react-router';
import {
  DateComponent,
  Details,
  EmptyStateCustom,
  ListErrorState,
  LoadingSpinner,
  Table,
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

interface SummaryEntry {
  count?: number | null;
}

// The content of one kind of change of a version, a row per kind of content
// with how many units of it there are. A version that changed nothing of that
// kind says None.
const ContentSummary = ({
  label,
  data,
}: {
  label: string;
  data: Record<string, SummaryEntry> | null | undefined;
}) => {
  const entries = Object.entries(data ?? {}).sort(([a], [b]) =>
    a < b ? -1 : 1,
  );
  if (entries.length === 0) {
    return <>{t`None`}</>;
  }

  return (
    <Table aria-label={label} variant='compact'>
      <Thead>
        <Tr>
          <Th>{t`Count`}</Th>
          <Th>{t`Pulp type`}</Th>
        </Tr>
      </Thead>
      <Tbody>
        {entries.map(([type, { count }]) => (
          <Tr key={type}>
            <Td>{count ?? t`Not available`}</Td>
            <Td>{type}</Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
};

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
  const summary = version.content_summary;

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
            label: t`Content added`,
            value: (
              <ContentSummary label={t`Content added`} data={summary?.added} />
            ),
          },
          {
            label: t`Content removed`,
            value: (
              <ContentSummary
                label={t`Content removed`}
                data={summary?.removed}
              />
            ),
          },
          {
            label: t`Current content`,
            value: (
              <ContentSummary
                label={t`Current content`}
                data={summary?.present}
              />
            ),
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
    </div>
  );
};
