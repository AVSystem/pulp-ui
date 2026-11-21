import { msg, plural, t } from '@lingui/core/macro';
import {
  AlertActionLink,
  Button,
  Checkbox,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from '@patternfly/react-core';
import { Td, Tr } from '@patternfly/react-table';
import { useId, useRef, useState } from 'react';
import { AnsibleRepositoryAPI } from '../api/ansible-repository';
import {
  type AnsibleCollectionVersion,
  CollectionVersionAPI,
} from '../api/collection-version';
import { Alert } from '../components';
import {
  AlertList,
  type AlertType,
  closeAlert,
} from '../components/alert-list';
import { DetailList } from '../components/detail-list';
import { ACTION_PERMISSIONS } from '../utilities/action-permissions';
import { handleHttpError } from '../utilities/fail-alerts';
import { isSessionEnd } from '../utilities/request-error';
import { taskAlert } from '../utilities/task-alert';
import { Action } from './action';
import './ansible-repository-collection-version-add.scss';
import { reloadAfterContentTask } from './repository-content-task';

// Adds the collection versions to the repository, then reloads the page once
// the task is done so the tab lists the new latest version. A request that
// did not go through because the session ended leaves the dialog open with
// the selection, and nothing is sent again by itself.
async function add(
  { repositoryHref, repositoryName },
  collections: AnsibleCollectionVersion[],
  { addAlert, setState, reloadPage },
) {
  const collectionVersionHrefs = collections.map((c) => c.pulp_href);
  const failed = handleHttpError(
    plural(collections.length, {
      one: `Failed to add collection to repository "${repositoryName}".`,
      other: `Failed to add collections to repository "${repositoryName}".`,
    }),
    () => setState((ms) => ({ ...ms, addCollectionVersionModal: null })),
    addAlert,
  );

  let task;
  try {
    ({
      data: { task },
    } = await AnsibleRepositoryAPI.addContent(
      repositoryHref,
      collectionVersionHrefs,
    ));
  } catch (e) {
    if (!isSessionEnd(e)) {
      failed(e);
    }
    return;
  }

  collections.forEach(({ name, namespace, version }) => {
    addAlert(
      taskAlert(
        task,
        t`Started adding ${namespace}.${name} v${version} to repository "${repositoryName}".`,
      ),
    );
  });
  setState((ms) => ({ ...ms, addCollectionVersionModal: null }));

  await reloadAfterContentTask(task, {
    addAlert,
    failed,
    reloadPage,
    repositoryName,
  });
}

// Selects the collection version, or unselects it when it is selected already.
// A version the repository already holds is never added to the selection.
function toggleCollection(
  clicked: AnsibleCollectionVersion,
  collections: AnsibleCollectionVersion[],
  held: ReadonlySet<string>,
): AnsibleCollectionVersion[] {
  if (held.has(clicked.pulp_href)) {
    return collections;
  }

  return collections.some(({ pulp_href }) => pulp_href === clicked.pulp_href)
    ? collections.filter(({ pulp_href }) => pulp_href !== clicked.pulp_href)
    : [...collections, clicked];
}

// What the dialog knows about the content of the repository's latest version:
// not yet (pending), not at all (failed), or the versions of the shown page
// that it holds (done).
type ContentRead = 'pending' | 'failed' | 'done';

const AddCollectionVersionModal = ({
  addAction,
  closeAction,
  latestVersionHref,
}: {
  addAction: (selected) => Promise<void>;
  closeAction: () => void;
  // the latest version of the repository; null for a repository without one
  latestVersionHref: string | null;
}) => {
  const labelId = useId();
  const [alerts, setAlerts] = useState([]);
  // set while the add request runs, so a second click cannot send it again
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<AnsibleCollectionVersion[]>([]);

  const [contentRead, setContentRead] = useState<ContentRead>('pending');
  // every version seen so far that the repository holds, on any page
  const [held, setHeld] = useState<ReadonlySet<string>>(new Set());
  // the versions of the page the content read is about, for a retry
  const pageHrefs = useRef<string[]>([]);
  // numbers the content reads, so an answer for an older page is dropped
  const latestRead = useRef(0);
  // numbers the list requests, so only the newest answer starts a content read
  const latestList = useRef(0);

  const addAlert = (alert: AlertType) => {
    setAlerts([...alerts, alert]);
  };

  // Asks which of the page's versions the latest repository version holds,
  // with one request for the page. Until it answers, or after it failed,
  // nothing can be selected: a version could be added that is already there.
  // A failure that only means the session ended shows nothing and keeps the
  // pending state; the list reads again after signing in.
  const readContent = (hrefs: string[]) => {
    pageHrefs.current = hrefs;
    const read = ++latestRead.current;

    if (!latestVersionHref || !hrefs.length) {
      setContentRead('done');
      return;
    }

    setContentRead('pending');
    CollectionVersionAPI.list({
      repository_version: latestVersionHref,
      pulp_href__in: hrefs.join(','),
      page: 1,
      page_size: hrefs.length,
    })
      .then(({ data: { results } }) => {
        if (read === latestRead.current) {
          setHeld((known) => {
            const all = new Set(known);
            results.forEach(({ pulp_href }) => all.add(pulp_href));
            return all;
          });
          setContentRead('done');
        }
      })
      .catch((e) => {
        if (read === latestRead.current && !isSessionEnd(e)) {
          setContentRead('failed');
        }
      });
  };

  // The plain content endpoint answers a filter it does not know with
  // "Invalid Filter", so the sort key of the list never goes on the request.
  // Only the answer of the newest list request starts a content read: the list
  // drops the rows of an older answer, so a read for them would replace the
  // read for the page on screen and leave its held versions unmarked.
  // @ts-expect-error: TS2525: Initializer provides no value for this binding element and the binding element has no default value.
  const query = ({ params } = {}) => {
    const request = ++latestList.current;
    const rest = { ...params };
    delete rest.sort;
    return CollectionVersionAPI.list(rest).then((response) => {
      if (request === latestList.current) {
        readContent(
          response.data.results.map(
            ({ pulp_href }: AnsibleCollectionVersion) => pulp_href,
          ),
        );
      }
      return response;
    });
  };

  const [modalState, setModalState] = useState({});

  const renderTableRow = (item: AnsibleCollectionVersion, index: number) => {
    const { name, namespace, version, description } = item;
    const inRepository = held.has(item.pulp_href);
    const selectable = contentRead === 'done' && !inRepository;

    return (
      <Tr
        className={inRepository ? 'pulp-collection-in-repository' : undefined}
        onClick={() => {
          if (selectable) {
            setSelected(toggleCollection(item, selected, held));
          }
        }}
        key={index}
      >
        <Td>
          <Checkbox
            aria-label={
              inRepository
                ? t`${namespace}.${name} v${version}, already in the repository`
                : `${namespace}.${name} v${version}`
            }
            id={`collection-${index}`}
            isChecked={
              !inRepository &&
              selected.some(({ pulp_href }) => pulp_href === item.pulp_href)
            }
            isDisabled={!selectable}
            name={`collection-${index}`}
          />
        </Td>
        <Td>
          <span className='pulp-collection-name'>
            {namespace}.{name} v{version}
            {inRepository ? <Label isCompact>{t`In repository`}</Label> : null}
          </span>
        </Td>
        <Td>{description}</Td>
      </Tr>
    );
  };

  return (
    <Modal
      aria-labelledby={labelId}
      isOpen
      onClose={closeAction}
      variant='large'
    >
      <ModalHeader labelId={labelId} title={t`Select a collection`} />
      <ModalBody>
        <section className='modal-body' data-cy='modal-body'>
          {contentRead === 'failed' ? (
            <Alert
              actionLinks={
                <AlertActionLink
                  aria-label={t`Retry loading the repository content`}
                  onClick={() => readContent(pageHrefs.current)}
                >
                  {t`Retry`}
                </AlertActionLink>
              }
              className='pulp-collection-read-failed'
              isInline
              title={t`The repository content could not be read`}
              variant='danger'
            >
              {t`Collections already in the repository cannot be marked, so none can be selected yet.`}
            </Alert>
          ) : null}
          <DetailList<AnsibleCollectionVersion>
            actionContext={{
              addAlert,
              state: modalState,
              setState: setModalState,
              query,
              // nothing in this list declares a permission
              hasPermission: () => false,
            }}
            busy={contentRead === 'pending'}
            compact
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
      </ModalBody>
      <ModalFooter>
        <Button
          key='confirm'
          onClick={() => {
            setPending(true);
            addAction(
              selected.filter(({ pulp_href }) => !held.has(pulp_href)),
            ).finally(() => setPending(false));
          }}
          variant='primary'
          isDisabled={!selected.length || pending || contentRead !== 'done'}
          isLoading={pending}
        >
          {t`Select`}
        </Button>
        <Button key='cancel' onClick={closeAction} variant='link'>
          {t`Cancel`}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export const ansibleRepositoryCollectionVersionAddAction = Action({
  title: msg`Add collection`,
  // The action sits in the header of the collection versions tab, which has no
  // item: the tab's context answers for the repository it belongs to, so the
  // check is made here instead of through the permission parameter.
  visible: (_item, { hasObjectPermission, hasPermission }) =>
    !!hasPermission?.(ACTION_PERMISSIONS.ansible.repository.modify) ||
    !!hasObjectPermission?.(ACTION_PERMISSIONS.ansible.repository.modify),
  modal: ({ addAlert, state, setState, reloadPage }) =>
    state.addCollectionVersionModal ? (
      <AddCollectionVersionModal
        addAction={(collections: AnsibleCollectionVersion[]) =>
          add(state.addCollectionVersionModal, collections, {
            addAlert,
            setState,
            reloadPage,
          })
        }
        closeAction={() =>
          setState((ms) => ({ ...ms, addCollectionVersionModal: null }))
        }
        latestVersionHref={
          state.addCollectionVersionModal.latestVersionHref ?? null
        }
      />
    ) : null,
  onClick: (
    _item,
    {
      state: {
        repository: {
          name: repositoryName,
          pulp_href: repositoryHref,
          latest_version_href: latestVersionHref,
        },
      },
      setState,
    },
  ) =>
    setState((ms) => ({
      ...ms,
      addCollectionVersionModal: {
        repositoryHref,
        repositoryName,
        latestVersionHref,
      },
    })),
});
