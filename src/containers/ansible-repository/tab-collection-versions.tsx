import { t } from '@lingui/core/macro';
import { Td, Tr } from '@patternfly/react-table';
import { useEffect, useState } from 'react';
import { ansibleRepositoryCollectionVersionAddAction } from '../../actions/ansible-repository-collection-version-add';
import { ansibleRepositoryCollectionVersionRemoveAction } from '../../actions/ansible-repository-collection-version-remove';
import { type AnsibleRepositoryType } from '../../api/ansible-repository';
import {
  type AnsibleCollectionVersion,
  CollectionVersionAPI,
} from '../../api/collection-version';
import { DetailList } from '../../components/detail-list';
import { ListItemActions } from '../../components/list-item-actions';

interface TabProps {
  item: AnsibleRepositoryType;
  actionContext: {
    addAlert: (alert) => void;
    state: { params };
    hasPermission;
  };
}

export const CollectionVersionsTab = ({
  item,
  actionContext: { addAlert, hasPermission },
}: TabProps) => {
  // The list of the plain content endpoint knows the filters namespace, name,
  // version, q and tags and the repository version filters; any other key is
  // answered with "Invalid Filter". The columns are not sortable, so the sort
  // key of the list never goes on the request.
  // @ts-expect-error: TS2525: Initializer provides no value for this binding element and the binding element has no default value.
  const query = ({ params } = {}) => {
    const { sort: _sort, ...rest } = { ...params };

    return CollectionVersionAPI.list({
      ...rest,
      repository_version: item.latest_version_href,
    }).then(({ data: { count, results } }) => ({
      data: { count, results },
    }));
  };

  const [modalState, setModalState] = useState({ repository: item });
  useEffect(() => setModalState((ms) => ({ ...ms, repository: item })), [item]);

  const renderTableRow = (
    item: AnsibleCollectionVersion,
    index: number,
    actionContext,
    listItemActions,
  ) => {
    const { name, namespace, version, description } = item;

    const kebabItems = listItemActions.map((action) =>
      action.dropdownItem(item, actionContext),
    );

    return (
      <Tr key={index}>
        <Td>
          {namespace}.{name} v{version}
        </Td>
        <Td>{description}</Td>
        <ListItemActions kebabItems={kebabItems} />
      </Tr>
    );
  };

  return (
    <DetailList<AnsibleCollectionVersion>
      actionContext={{
        addAlert,
        state: modalState,
        setState: setModalState,
        query,
        hasPermission,
        hasObjectPermission: (p: string): boolean =>
          item?.my_permissions?.includes?.(p),
      }}
      defaultPageSize={10}
      errorTitle={t`Collection versions could not be displayed.`}
      filterConfig={[
        {
          id: 'namespace',
          title: t`Namespace`,
        },
        {
          id: 'name',
          title: t`Name`,
        },
      ]}
      headerActions={[ansibleRepositoryCollectionVersionAddAction]}
      listItemActions={[ansibleRepositoryCollectionVersionRemoveAction]}
      noDataButton={ansibleRepositoryCollectionVersionAddAction.button}
      noDataDescription={t`Collection versions will appear once the collection is modified.`}
      noDataTitle={t`No collection versions yet`}
      query={query}
      renderTableRow={renderTableRow}
      sortHeaders={[
        {
          title: t`Collection`,
          type: 'none',
          id: 'col1',
        },
        {
          title: t`Description`,
          type: 'none',
          id: 'col2',
        },
      ]}
      title={t`Collection versions`}
    />
  );
};
