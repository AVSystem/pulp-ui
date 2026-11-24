import { msg, t } from '@lingui/core/macro';
import { DropdownItem } from '@patternfly/react-core';
import { Tbody, Td, Tr } from '@patternfly/react-table';
import { useMemo, useRef, useState } from 'react';
import {
  AlertList,
  BaseHeader,
  ClipboardCopy,
  DateComponent,
  EmptyStateFilter,
  EmptyStateNoData,
  InsufficientPermissions,
  ListErrorState,
  ListItemActions,
  LoadingSpinner,
  Main,
  SortTable,
  Table,
  closeAlert,
} from 'src/components';
import type { SigningService } from 'src/entities/core/signing-service/model';
import { useSigningServices } from 'src/entities/core/signing-service/queries';
import { downloadString } from 'src/utilities/download-data';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorDetail,
  requestErrorStatus,
} from 'src/utilities/request-error';
import type { FilterDef } from '../descriptor';
import { FilterChips, ListFilters } from '../list/filters';
import {
  ListLayout,
  useLastPageWhenPastEnd,
  useListAddress,
  useRereadAlert,
} from '../list/list-frame';

// The server matches a name exactly, so the filter takes the whole name of a
// service.
const FILTERS: FilterDef[] = [
  { id: 'name', label: msg`Name`, param: 'name', kind: 'text' },
];

// The fields the server can order the services by.
const SORTABLE = [{ sortField: 'name' }, { sortField: 'pulp_created' }];

const noop = () => undefined;

// The signing services of the server, with the public key of each: what a
// customer configures next to a deb or rpm repository to check its signature.
// The address holds the page, its size, the order and the name filter, and the
// screen shows exactly what it says. A failed read is shown as a failure, with
// a button that reads again, and never as a server without keys.
const SignatureKeyList = () => {
  const { params, filterIsSet, updateParams } = useListAddress(
    SORTABLE,
    FILTERS,
  );
  const request = useMemo(
    () => ({
      page: params.page,
      page_size: params.page_size,
      sort: params.sort,
      ...(typeof params['name'] === 'string' ? { name: params['name'] } : {}),
    }),
    [params],
  );

  const query = useSigningServices(request);
  const data = query.data;
  const rows = useMemo(() => data?.results ?? [], [data]);
  const pastEnd = useLastPageWhenPastEnd(
    data,
    params,
    !query.isPlaceholderData,
  );

  // The first read fills the whole screen with its state. Once something has
  // been shown, a read for another filter shows its state in place of the
  // table only, so the filters stay where they are being used.
  const everShown = useRef(false);
  if (data) {
    everShown.current = true;
  }

  const [alerts, setAlerts] = useState<
    Parameters<typeof AlertList>[0]['alerts']
  >([]);
  useRereadAlert(query, t`Signature keys could not be displayed.`, setAlerts);

  const header = <BaseHeader title={t`Signature keys`} />;
  const alertList = (
    <AlertList
      alerts={alerts}
      closeAlert={(i) => closeAlert(i, { alerts, setAlerts })}
    />
  );

  // A refused read is not a failure to retry: the user is told they may not
  // view the list, with Pulp's own reason.
  if (query.isError && requestErrorStatus(query.error) === 403) {
    return (
      <>
        {alertList}
        {header}
        <InsufficientPermissions detail={requestErrorDetail(query.error)} />
      </>
    );
  }

  const sessionEnded = query.isError && isSessionEnd(query.error);
  const failed = query.isError && !sessionEnded && !data && !query.isFetching;
  const loading = !data && !failed;

  if (loading && !everShown.current) {
    return (
      <>
        {alertList}
        {header}
        <Main>
          <LoadingSpinner />
        </Main>
      </>
    );
  }
  if (failed && !everShown.current) {
    return (
      <>
        {alertList}
        {header}
        <Main>
          <ListErrorState
            title={t`Signature keys could not be displayed.`}
            message={requestErrorDescription(query.error)}
            onRetry={() => query.refetch()}
          />
        </Main>
      </>
    );
  }
  if (!!data && data.count === 0 && !filterIsSet) {
    return (
      <>
        {alertList}
        {header}
        <EmptyStateNoData
          title={t`No signature keys yet`}
          description={t`Signature keys will appear once created.`}
        />
      </>
    );
  }

  const count = data?.count ?? 0;
  const hasRows = !!data && rows.length > 0;

  let content;
  if (loading || pastEnd) {
    content = <LoadingSpinner />;
  } else if (failed) {
    content = (
      <ListErrorState
        title={t`Signature keys could not be displayed.`}
        message={requestErrorDescription(query.error)}
        onRetry={() => query.refetch()}
      />
    );
  } else if (rows.length === 0) {
    content = (
      <EmptyStateFilter
        clearAllFilters={() =>
          updateParams({
            page: 1,
            page_size: params.page_size,
            sort: params.sort,
          })
        }
      />
    );
  } else {
    content = (
      <Table
        aria-label={t`Signature keys`}
        data-rows-loaded={!query.isPlaceholderData}
      >
        <SortTable
          options={{
            headers: [
              { id: 'name', title: t`Name`, type: 'alpha' },
              {
                id: 'pubkey_fingerprint',
                title: t`Key fingerprint`,
                type: 'none',
              },
              { id: 'pulp_created', title: t`Created on`, type: 'numeric' },
              { id: 'public_key', title: t`Public key`, type: 'none' },
              { id: 'actions', title: '', type: 'none' },
            ],
          }}
          params={params}
          updateParams={updateParams}
        />
        <Tbody>
          {rows.map((row) => (
            <SignatureKeyRow key={row.pulp_href} row={row} />
          ))}
        </Tbody>
      </Table>
    );
  }

  return (
    <>
      {alertList}
      {header}
      <ListLayout
        filters={
          <ListFilters
            filters={FILTERS}
            params={params}
            updateParams={updateParams}
            labelKeys={[]}
            labelRefusal={null}
            onLabelFilterOpen={noop}
          />
        }
        addButton={undefined}
        params={params}
        updateParams={updateParams}
        count={count}
        chips={
          <FilterChips
            filters={FILTERS}
            params={params}
            updateParams={updateParams}
          />
        }
        content={content}
        hasRows={hasRows}
      />
    </>
  );
};

const SignatureKeyRow = ({ row }: { row: SigningService }) => {
  const key = row.public_key ?? '';

  return (
    <Tr data-cy={`SignatureKeyList-row-${row.name}`}>
      <Td>{row.name}</Td>
      <Td data-cy='pulp-signature-list-fingerprint'>
        {row.pubkey_fingerprint}
      </Td>
      <Td>
        <DateComponent date={row.pulp_created} />
      </Td>
      <Td>
        <ClipboardCopy isCode isReadOnly variant='expansion'>
          {key}
        </ClipboardCopy>
      </Td>
      <ListItemActions
        kebabItems={[
          <DropdownItem
            key='download-key'
            isDisabled={key === ''}
            onClick={() => downloadString(key, `${row.name}.asc`)}
          >
            {t`Download key`}
          </DropdownItem>,
        ]}
      />
    </Tr>
  );
};

export default SignatureKeyList;
