import { msg, plural, t } from '@lingui/core/macro';
import { Button, Checkbox, Modal } from '@patternfly/react-core';
import { Td, Tr } from '@patternfly/react-table';
import { useState } from 'react';
import { AnsibleRepositoryAPI } from '../api/ansible-repository';
import {
  type AnsibleCollectionVersion,
  CollectionVersionAPI,
} from '../api/collection-version';
import {
  AlertList,
  type AlertType,
  closeAlert,
} from '../components/alert-list';
import { DetailList } from '../components/detail-list';
import { handleHttpError } from '../utilities/fail-alerts';
import { parsePulpIDFromURL } from '../utilities/parse-pulp-id';
import { taskAlert } from '../utilities/task-alert';
import { Action } from './action';

const add = (
  { repositoryHref, repositoryName },
  collections: AnsibleCollectionVersion[],
  { addAlert, setState, query },
) => {
  const pulpId = parsePulpIDFromURL(repositoryHref);
  const collectionVersionHrefs = collections.map((c) => c.pulp_href);
  return AnsibleRepositoryAPI.addContent(pulpId, collectionVersionHrefs)
    .then(({ data }) => {
      collections.forEach(({ name, namespace, version }) => {
        addAlert(
          taskAlert(
            data.task,
            t`Started adding ${namespace}.${name} v${version} to repository "${repositoryName}".`,
          ),
        );
      });
      setState((ms) => ({ ...ms, addCollectionVersionModal: null }));
      query({});
    })
    .catch(
      handleHttpError(
        plural(collections.length, {
          one: `Failed to add collection to repository "${repositoryName}".`,
          other: `Failed to add collections to repository "${repositoryName}".`,
        }),
        () => setState((ms) => ({ ...ms, addCollectionVersionModal: null })),
        addAlert,
      ),
    );
};

// Selects the collection version, or unselects it when it is selected already.
function toggleCollection(
  clicked: AnsibleCollectionVersion,
  collections: AnsibleCollectionVersion[],
): AnsibleCollectionVersion[] {
  return collections.some(({ pulp_href }) => pulp_href === clicked.pulp_href)
    ? collections.filter(({ pulp_href }) => pulp_href !== clicked.pulp_href)
    : [...collections, clicked];
}

const AddCollectionVersionModal = ({
  addAction,
  closeAction,
}: {
  addAction: (selected) => void;
  closeAction: () => void;
}) => {
  const [alerts, setAlerts] = useState([]);
  const [selected, setSelected] = useState<AnsibleCollectionVersion[]>([]);

  const addAlert = (alert: AlertType) => {
    setAlerts([...alerts, alert]);
  };

  // The plain content endpoint answers a filter it does not know with
  // "Invalid Filter", so the sort key of the list never goes on the request.
  // @ts-expect-error: TS2525: Initializer provides no value for this binding element and the binding element has no default value.
  const query = ({ params } = {}) => {
    const rest = { ...params };
    delete rest.sort;
    return CollectionVersionAPI.list(rest);
  };

  const [modalState, setModalState] = useState({});

  const renderTableRow = (item: AnsibleCollectionVersion, index: number) => {
    const { name, namespace, version, description } = item;

    return (
      <Tr
        onClick={() => setSelected(toggleCollection(item, selected))}
        key={index}
      >
        <Td>
          <Checkbox
            aria-label={`${namespace}.${name} v${version}`}
            id={`collection-${index}`}
            isChecked={selected.some(
              ({ pulp_href }) => pulp_href === item.pulp_href,
            )}
            name={`collection-${index}`}
          />
        </Td>
        <Td>
          {namespace}.{name} v{version}
        </Td>
        <Td>{description}</Td>
      </Tr>
    );
  };

  return (
    <Modal
      actions={[
        <Button
          key='confirm'
          onClick={() => addAction(selected)}
          variant='primary'
          isDisabled={!selected.length}
        >
          {t`Select`}
        </Button>,
        <Button key='cancel' onClick={closeAction} variant='link'>
          {t`Cancel`}
        </Button>,
      ]}
      isOpen
      onClose={closeAction}
      title={t`Select a collection`}
      variant='large'
    >
      <section className='modal-body' data-cy='modal-body'>
        <DetailList<AnsibleCollectionVersion>
          actionContext={{
            addAlert,
            state: modalState,
            setState: setModalState,
            query,
            hasPermission: () => {
              throw 'unused';
            },
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
          noDataDescription={t`Collection versions will appear once a collection is uploaded.`}
          noDataTitle={t`No collection versions yet`}
          query={query}
          renderTableRow={renderTableRow}
          sortHeaders={[
            {
              title: '',
              type: 'none',
              id: 'radio',
            },
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
      </section>

      <AlertList
        alerts={alerts}
        closeAlert={(i) => closeAlert(i, { alerts, setAlerts })}
      />
    </Modal>
  );
};

export const ansibleRepositoryCollectionVersionAddAction = Action({
  title: msg`Add collection`,
  modal: ({ addAlert, state, setState, query }) =>
    state.addCollectionVersionModal ? (
      <AddCollectionVersionModal
        addAction={(collections: AnsibleCollectionVersion[]) => {
          add(state.addCollectionVersionModal, collections, {
            addAlert,
            setState,
            query,
          });
        }}
        closeAction={() =>
          setState((ms) => ({ ...ms, addCollectionVersionModal: null }))
        }
      />
    ) : null,
  onClick: (
    _item,
    {
      state: {
        repository: { name: repositoryName, pulp_href: repositoryHref },
      },
      setState,
    },
  ) =>
    setState((ms) => ({
      ...ms,
      addCollectionVersionModal: {
        repositoryHref,
        repositoryName,
      },
    })),
});
