import { t } from '@lingui/core/macro';
import { Td, Tr } from '@patternfly/react-table';
import { type ActionType } from 'src/actions/action';
import { pythonDistributionEditAction } from 'src/actions/python-distribution-edit';
import { type PythonRepositoryType } from 'src/api/python-repository';
import { ClipboardCopy, DateComponent, DetailList } from 'src/components';
import { DistributionURL } from 'src/components/distribution-url';
import { ListItemActions } from 'src/components/list-item-actions';
import {
  type RepositoryDistribution,
  listLoadedDistributions,
} from 'src/utilities/repository-distributions';

interface TabProps {
  item: PythonRepositoryType & {
    distributions?: RepositoryDistribution[];
    distributionsError?: string | null;
  };
  actionContext: {
    addAlert: (alert) => void;
    // loads the repository page again, with its distributions
    query?: () => void;
    setState?: (state) => void;
    state: { params };
    hasPermission;
  };
}

export const DistributionsTab = ({
  item,
  actionContext: {
    addAlert,
    hasPermission,
    query: reloadPage,
    setState,
    state: pageState,
  },
}: TabProps) => {
  // The page loaded every distribution serving the repository (bound to it,
  // to one of its publications or to one of its versions), so the list is cut
  // from those; a failed load is shown as the list's error.
  const query = ({ params } = { params: null }) =>
    item.distributionsError
      ? Promise.reject(item.distributionsError)
      : Promise.resolve(listLoadedDistributions(item.distributions, params));

  // pip looks for packages in the simple index under the URL the server
  // reports for the distribution.
  const cliConfig = (url: string | null) =>
    url
      ? `pip install --index-url ${url.endsWith('/') ? url : `${url}/`}simple/ <package>`
      : t`None`;

  const renderTableRow = (
    item: RepositoryDistribution,
    index: number,
    actionContext,
    listItemActions: ActionType[],
  ) => {
    const { name, base_path, pulp_created, url } = item;
    const kebabItems = listItemActions.map((action) =>
      action.dropdownItem(item, actionContext),
    );

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
        <ListItemActions kebabItems={kebabItems} />
      </Tr>
    );
  };

  return (
    <DetailList<RepositoryDistribution>
      actionContext={{
        addAlert,
        // the actions reload the whole page, because the distributions of the
        // list were loaded by the page
        query: reloadPage,
        setState,
        state: pageState,
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
      listItemActions={[pythonDistributionEditAction]}
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
          title: t`Install with pip`,
          type: 'none',
          id: '',
        },
      ]}
      title={t`Distributions`}
    />
  );
};
