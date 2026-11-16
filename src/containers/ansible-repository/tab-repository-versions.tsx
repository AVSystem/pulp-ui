import { t } from '@lingui/core/macro';
import { PageSection } from '@patternfly/react-core';
import { Td, Th, Tr } from '@patternfly/react-table';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ansibleRepositoryVersionRevertAction } from 'src/actions';
import {
  AnsibleRepositoryAPI,
  type AnsibleRepositoryType,
  GenericPulpAPI,
} from 'src/api';
import {
  DateComponent,
  DetailList,
  Details,
  EmptyStateCustom,
  ListItemActions,
  Spinner,
  Table,
} from 'src/components';
import { Paths, formatPath } from 'src/paths';
import { config } from 'src/ui-config';
import { useSessionEpoch } from 'src/user-context';
import { parsePulpIDFromURL } from 'src/utilities';
import { useLatestRead } from 'src/utilities/latest-read';
import {
  isSessionEnd,
  requestErrorDescription,
} from 'src/utilities/request-error';

interface TabProps {
  item: AnsibleRepositoryType;
  actionContext: {
    addAlert: (alert) => void;
    state: { params };
    hasPermission: (string) => boolean;
    hasObjectPermission: (permission: string, target?: object) => boolean;
    // loads the repository page again
    query: () => void;
  };
}

type ContentSummary = Record<
  string,
  {
    count: number;
    href: string;
  }
>;

interface AnsibleRepositoryVersionType {
  pulp_href: string;
  pulp_created: string;
  number: number;
  repository: string;
  base_version: null;
  content_summary: {
    added: ContentSummary;
    removed: ContentSummary;
    present: ContentSummary;
  };
}

const VersionContent = ({
  href,
  addAlert,
  hasPermission,
}: {
  href: string;
  addAlert: (alert) => void;
  hasPermission: (string) => boolean;
}) => {
  const [state, setState] = useState({});
  if (!href) {
    return null;
  }

  // @ts-expect-error: TS2339: Property 'params' does not exist on type '{}'.
  const query = ({ params } = {}) =>
    GenericPulpAPI.list(href.replace(config.API_BASE_PATH, ''), params);

  const renderTableRow = ({
    manifest: {
      collection_info: { namespace, name, version },
    },
    description,
  }) => (
    <Tr>
      <Td>
        {namespace}.{name} v{version}
      </Td>
      <Td>{description}</Td>
    </Tr>
  );

  return (
    <DetailList<{ manifest; description; pulp_href }>
      actionContext={{
        addAlert,
        state,
        setState,
        query,
        hasPermission,
      }}
      defaultPageSize={10}
      defaultSort={'name'}
      errorTitle={t`Collection versions could not be displayed.`}
      noDataDescription={t`No collection versions in this repository version.`}
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

const ContentSummary = ({ data }: { data: object }) => {
  if (!Object.keys(data).length) {
    return <>{t`None`}</>;
  }

  return (
    <Table>
      <Tr>
        <Th>{t`Count`}</Th>
        <Th>{t`Pulp type`}</Th>
      </Tr>
      {Object.entries(data).map(([k, v]) => (
        <Tr key={k}>
          <Td>{v['count']}</Td>
          <Th>{k}</Th>
        </Tr>
      ))}
    </Table>
  );
};

const BaseVersion = ({
  repositoryName,
  data,
}: {
  repositoryName: string;
  data?: string;
}) => {
  if (!data) {
    return <>{t`None`}</>;
  }

  const number = data.split('/').at(-2);
  return (
    <Link
      to={formatPath(
        Paths.ansible.repository.detail,
        {
          name: repositoryName,
        },
        {
          repositoryVersion: number,
          tab: 'repository-versions',
        },
      )}
    >
      {number}
    </Link>
  );
};

export const RepositoryVersionsTab = ({
  item,
  actionContext: {
    addAlert,
    state,
    hasPermission,
    hasObjectPermission,
    query: reloadPage,
  },
}: TabProps) => {
  const pulpId = parsePulpIDFromURL(item.pulp_href);
  const latest_href = item.latest_version_href;
  const repositoryName = item.name;
  const queryList = ({ params }) =>
    AnsibleRepositoryAPI.listVersions(pulpId, params);
  const queryDetail = ({ number }) =>
    AnsibleRepositoryAPI.listVersions(pulpId, { number });
  const [modalState, setModalState] = useState({});
  // The answer to the last read, with the version number it was asked for. A
  // null version means the server has no such version. The answer is used only
  // while the page still shows that number, so the previous version never stays
  // on screen under a new number.
  const [answer, setAnswer] = useState<{
    number: string;
    version: AnsibleRepositoryVersionType | null;
  } | null>(null);
  const reads = useLatestRead();

  // grows when the same user signs in again, so the version is read again
  const epoch = useSessionEpoch();

  useEffect(() => {
    if (!state.params.repositoryVersion) {
      // the list is shown: answers for a version are of no use any more
      reads.invalidate();
      return;
    }

    const number = String(state.params.repositoryVersion);
    const ticket = reads.start();

    queryDetail({ number })
      .then(({ data }) => {
        if (!reads.isLatest(ticket)) {
          return;
        }

        const version = data?.results?.[0] ?? null;
        if (!version) {
          addAlert({
            variant: 'danger',
            title: t`Failed to find repository version`,
          });
        }
        setAnswer({ number, version });
      })
      .catch((e) => {
        // The session ended: the version stays as it is (or the spinner
        // keeps turning) and is read again after signing in.
        if (!reads.isLatest(ticket) || isSessionEnd(e)) {
          return;
        }

        addAlert({
          variant: 'danger',
          title: t`Failed to find repository version`,
          description: requestErrorDescription(e),
        });
      });
  }, [state.params.repositoryVersion, epoch]);

  const answered =
    answer && answer.number === String(state.params.repositoryVersion)
      ? answer
      : null;
  const version = answered?.version;

  const renderTableRow = (
    item: AnsibleRepositoryVersionType,
    index: number,
    actionContext,
    listItemActions,
  ) => {
    const { number, pulp_created, pulp_href } = item;

    const isLatest = latest_href === pulp_href;

    const kebabItems = listItemActions.map((action) =>
      action.dropdownItem({ ...item, isLatest, repositoryName }, actionContext),
    );

    return (
      <Tr key={index}>
        <Td>
          <Link
            to={formatPath(
              Paths.ansible.repository.detail,
              {
                name: repositoryName,
              },
              {
                repositoryVersion: number,
                tab: 'repository-versions',
              },
            )}
          >
            {number}
          </Link>
          {isLatest ? ' ' + t`(latest)` : null}
        </Td>
        <Td>
          <DateComponent date={pulp_created} />
        </Td>
        <ListItemActions kebabItems={kebabItems} />
      </Tr>
    );
  };

  return state.params.repositoryVersion ? (
    version ? (
      <>
        <Details
          fields={[
            { label: t`Version number`, value: version.number },
            {
              label: t`Created date`,
              value: <DateComponent date={version.pulp_created} />,
            },
            {
              label: t`Content added`,
              value: <ContentSummary data={version.content_summary?.added} />,
            },
            {
              label: t`Content removed`,
              value: <ContentSummary data={version.content_summary?.removed} />,
            },
            {
              label: t`Current content`,
              value: <ContentSummary data={version.content_summary?.present} />,
            },
            {
              label: t`Base version`,
              value: (
                <BaseVersion
                  repositoryName={repositoryName}
                  data={version.base_version}
                />
              ),
            },
          ]}
        />
        <PageSection
          component='div'
          hasBodyWrapper={false}
          style={{ padding: '8px 0', margin: '24px -16px 0' }}
        />
        <VersionContent
          addAlert={addAlert}
          hasPermission={hasPermission}
          {...version.content_summary.present['ansible.collection_version']}
        />
      </>
    ) : answered ? (
      <EmptyStateCustom
        description={null}
        title={t`Repository versions could not be displayed.`}
      />
    ) : (
      <Spinner size='md' />
    )
  ) : (
    <DetailList<AnsibleRepositoryVersionType>
      actionContext={{
        addAlert,
        state: modalState,
        setState: setModalState,
        query: queryList,
        reloadPage,
        hasPermission,
        // The rows are repository versions, which carry no permissions of their
        // own: the actions on them ask about the repository the page shows.
        hasObjectPermission: (permission) => hasObjectPermission(permission),
      }}
      defaultPageSize={10}
      defaultSort={'-pulp_created'}
      errorTitle={t`Repository versions could not be displayed.`}
      filterConfig={null}
      listItemActions={[ansibleRepositoryVersionRevertAction]}
      noDataButton={null}
      noDataDescription={t`Repository versions will appear once the repository is modified.`}
      noDataTitle={t`No repository versions yet`}
      query={queryList}
      renderTableRow={renderTableRow}
      sortHeaders={[
        {
          title: t`Version number`,
          type: 'numeric',
          id: 'number',
        },
        {
          title: t`Created date`,
          type: 'numeric',
          id: 'pulp_created',
        },
      ]}
      title={t`Repository versions`}
    />
  );
};
