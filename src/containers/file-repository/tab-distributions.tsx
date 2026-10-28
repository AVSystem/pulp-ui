import { t } from '@lingui/core/macro';
import { Td, Tr } from '@patternfly/react-table';
import { type FileRepositoryType } from 'src/api';
import { ClipboardCopy, DateComponent, DetailList } from 'src/components';
import { DistributionURL } from 'src/components/distribution-url';
import {
  type RepositoryDistribution,
  listLoadedDistributions,
} from 'src/utilities/repository-distributions';

interface TabProps {
  item: FileRepositoryType & {
    distributions?: RepositoryDistribution[];
    distributionsError?: string | null;
  };
  actionContext: {
    addAlert: (alert) => void;
    state: { params };
    hasPermission;
  };
}

export const DistributionsTab = ({
  item,
  actionContext: { addAlert, hasPermission },
}: TabProps) => {
  // The page loaded every distribution serving the repository (bound to it,
  // to one of its publications or to one of its versions), so the list is cut
  // from those; a failed load is shown as the list's error.
  const query = ({ params } = { params: null }) =>
    item.distributionsError
      ? Promise.reject(item.distributionsError)
      : Promise.resolve(listLoadedDistributions(item.distributions, params));

  // The manifest sits next to the content, at the distribution's URL.
  const cliConfig = (url: string | null) =>
    url
      ? `pulp file remote create --name "${item.name}" --url "${url}PULP_MANIFEST"`
      : t`None`;

  const renderTableRow = (
    item: RepositoryDistribution,
    index: number,
    _actionContext,
  ) => {
    const { name, base_path, pulp_created, url } = item;

    return (
      <Tr key={index}>
        <Td>{name}</Td>
        <Td>{base_path}</Td>
        <Td>
          <DistributionURL distribution={item} />
        </Td>
        <Td>
          <DateComponent date={pulp_created} />
        </Td>
        <Td>
          <ClipboardCopy
            isCode
            isReadOnly
            variant={'inline-compact'}
            key={index}
          >
            {cliConfig(url)}
          </ClipboardCopy>
        </Td>
      </Tr>
    );
  };

  return (
    <DetailList<RepositoryDistribution>
      actionContext={{
        addAlert,
        query,
        hasPermission,
        hasObjectPermission: (_p: string): boolean => true,
      }}
      defaultPageSize={10}
      defaultSort={'name'}
      errorTitle={t`Distributions could not be displayed.`}
      filterConfig={[
        {
          id: 'name__icontains',
          title: t`Name`,
        },
        {
          id: 'base_path__icontains',
          title: t`Base path`,
        },
      ]}
      noDataDescription={t`Clients cannot download its content until a distribution serves it.`}
      noDataTitle={t`No distribution serves this repository`}
      query={query}
      renderTableRow={renderTableRow}
      sortHeaders={[
        {
          title: t`Name`,
          type: 'alpha',
          id: 'name',
        },
        {
          title: t`Base path`,
          type: 'alpha',
          id: 'base_path',
        },
        {
          title: t`URL`,
          type: 'none',
          id: 'url',
        },
        {
          title: t`Created`,
          type: 'alpha',
          id: 'pulp_created',
        },
        {
          title: t`CLI configuration`,
          type: 'none',
          id: '',
        },
      ]}
      title={t`Distributions`}
    />
  );
};
