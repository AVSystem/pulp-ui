import { t } from '@lingui/core/macro';
import { Td, Tr } from '@patternfly/react-table';
import { type DebRepositoryType } from 'src/api/deb-repository';
import { ClipboardCopy, DateComponent, DetailList } from 'src/components';
import { DistributionURL } from 'src/components/distribution-url';
import {
  type RepositoryDistribution,
  listLoadedDistributions,
} from 'src/utilities/repository-distributions';
import { shellQuote } from 'src/utilities/shell-quote';

interface TabProps {
  item: DebRepositoryType & {
    distributions?: RepositoryDistribution[];
    distributionsError?: string | null;
  };
  actionContext: {
    addAlert: (alert) => void;
    // loads the repository page again, with its distributions
    query?: () => void;
    state: { params };
    hasPermission;
  };
}

// A deb remote requires `distributions`, so unlike the file equivalent this
// cannot be a complete command without knowing which suites to sync. The name
// and the URL are quoted as shell words: a repository name is free text.
export const debRemoteCommand = (name: string, url: string): string =>
  `pulp deb remote create --name ${shellQuote(name)} --url ${shellQuote(url)} --distributions '<suite>'`;

export const DistributionsTab = ({
  item,
  actionContext: { addAlert, hasPermission, query: reloadPage },
}: TabProps) => {
  // The page loaded every distribution serving the repository (bound to it,
  // to one of its publications or to one of its versions), so the list is cut
  // from those; a failed load is shown as the list's error.
  const query = ({ params } = { params: null }) =>
    item.distributionsError
      ? Promise.reject(item.distributionsError)
      : Promise.resolve(listLoadedDistributions(item.distributions, params));

  const cliConfig = (url: string | null) =>
    url ? debRemoteCommand(item.name, url) : t`None`;

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
        // No hasObjectPermission: an apt repository carries no my_permissions to
        // check, and nothing in this list is gated on one. Whoever adds an action
        // that is wants a real check here, not a stub that always agrees.
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
      // a failed load came from the page, so only the page can load it again
      onRetry={reloadPage}
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
