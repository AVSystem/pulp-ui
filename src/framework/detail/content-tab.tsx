import { i18n } from '@lingui/core';
import type { MessageDescriptor } from '@lingui/core';
import {
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
} from '@patternfly/react-core';
import { Tbody, Td, Tr } from '@patternfly/react-table';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  AppliedFilters,
  CompoundFilter,
  EmptyStateFilter,
  EmptyStateNoData,
  ListErrorState,
  LoadingSpinner,
  PulpPagination,
  SortTable,
  Table,
} from 'src/components';
import type {
  ContentEntity,
  ContentListParams,
} from 'src/entities/plugin/content';
import { useEntityList } from 'src/entities/plugin/queries';
import {
  isSessionEnd,
  requestErrorDescription,
} from 'src/utilities/request-error';
import {
  type ListParams,
  PAGE_SIZES,
  paramsOfAddress,
  searchOf,
} from '../list/list-params';

// One column of a content list. A column the server orders by names the field;
// every other column never sorts.
export interface ContentColumn<Row> {
  id: string;
  label: MessageDescriptor;
  sortField?: string;
  render: (row: Row) => ReactNode;
}

// One filter of a content list, by the query parameter the server takes.
export interface ContentFilter {
  param: string;
  label: MessageDescriptor;
}

// What a plugin declares about the list of one kind of content its repositories
// hold: where it is read from, what is shown and filtered, and what is said
// when there is nothing to show. The words are message descriptors, translated
// where they are drawn.
export interface ContentListConfig<Row extends { pulp_href: string }> {
  entity: ContentEntity<Row>;
  // The fields of a row the list reads, which are the only ones asked for.
  fields: readonly string[];
  columns: readonly ContentColumn<Row>[];
  filters: readonly ContentFilter[];
  // The name of the table, for assistive technology.
  title: MessageDescriptor;
  errorTitle: MessageDescriptor;
  emptyTitle: MessageDescriptor;
  emptyDescription: MessageDescriptor;
  defaultPageSize: number;
  // The field the list is ordered by when the address names none.
  defaultSort: string;
}

interface Props<Row extends { pulp_href: string }> {
  config: ContentListConfig<Row>;
  // The address of the repository version whose content is listed, or none for
  // a repository that has no version yet. Without one nothing is read: the
  // server would list the content of every repository.
  version: string | null | undefined;
}

// The content of one repository version as a page of a table. The page, its
// size, the order and the filters are what the address says, so a page can be
// shared and the back button works. Every read is one request for the page.
export function ContentList<Row extends { pulp_href: string }>({
  config,
  version,
}: Props<Row>) {
  const { entity, fields, columns, filters, defaultPageSize, defaultSort } =
    config;
  const { search } = useLocation();
  const navigate = useNavigate();
  const [inputText, setInputText] = useState('');

  const options = useMemo(
    () => ({
      sortable: columns.flatMap(({ sortField }) =>
        sortField ? [sortField] : [],
      ),
      filters: filters.map(({ param }) => param),
      defaultPageSize,
      defaultSort,
    }),
    [columns, filters, defaultPageSize, defaultSort],
  );
  const params = useMemo(
    () => paramsOfAddress(search, options),
    [search, options],
  );
  const filterIsSet = options.filters.some(
    (param) => params[param] !== undefined,
  );
  const updateParams = (next: object) =>
    navigate({ search: searchOf(next as ListParams, options) });

  const request: ContentListParams = {
    ...params,
    repository_version: version ?? '',
    fields: [...fields],
  };
  const query = useEntityList(entity, request, { enabled: !!version });

  if (!version) {
    return (
      <EmptyStateNoData
        title={i18n._(config.emptyTitle)}
        description={i18n._(config.emptyDescription)}
      />
    );
  }

  const data = query.data;
  if (!data) {
    // A session that ended keeps the spinner: the sign-in dialog explains it
    // and the read runs again afterwards.
    return query.isError && !isSessionEnd(query.error) && !query.isFetching ? (
      <ListErrorState
        title={i18n._(config.errorTitle)}
        message={requestErrorDescription(query.error)}
        onRetry={() => query.refetch()}
      />
    ) : (
      <LoadingSpinner />
    );
  }

  const filterConfig = filters.map(({ param, label }) => ({
    id: param,
    title: i18n._(label),
  }));
  const headers = columns.map(({ id, label, sortField }) => ({
    id: sortField ?? id,
    title: i18n._(label),
    type: sortField ? 'alpha' : 'none',
  }));
  const clearFilters = () => {
    setInputText('');
    updateParams({
      page: 1,
      page_size: params.page_size,
      sort: params.sort,
    });
  };

  if (data.count === 0 && !filterIsSet) {
    return (
      <EmptyStateNoData
        title={i18n._(config.emptyTitle)}
        description={i18n._(config.emptyDescription)}
      />
    );
  }

  return (
    <>
      <div className='pulp-toolbar' data-cy='ContentTab'>
        <Toolbar>
          <ToolbarContent>
            <ToolbarGroup>
              <ToolbarItem>
                <CompoundFilter
                  inputText={inputText}
                  onChange={setInputText}
                  updateParams={(next) => {
                    setInputText('');
                    updateParams(next);
                  }}
                  params={params}
                  filterConfig={filterConfig}
                />
              </ToolbarItem>
            </ToolbarGroup>
          </ToolbarContent>
        </Toolbar>
        <PulpPagination
          params={params}
          updateParams={updateParams}
          count={data.count}
          perPageOptions={PAGE_SIZES}
          isTop
        />
      </div>
      <div>
        <AppliedFilters
          updateParams={(next) => {
            setInputText('');
            updateParams(next);
          }}
          params={params}
          ignoredParams={['page', 'page_size', 'sort']}
          niceNames={Object.fromEntries(
            filterConfig.map(({ id, title }) => [id, title]),
          )}
        />
      </div>
      {data.count === 0 ? (
        <EmptyStateFilter clearAllFilters={clearFilters} />
      ) : (
        <Table aria-label={i18n._(config.title)}>
          <SortTable
            options={{ headers }}
            params={params}
            updateParams={updateParams}
          />
          <Tbody>
            {data.results.map((row) => (
              <Tr key={row.pulp_href}>
                {columns.map(({ id, render }) => (
                  <Td key={id}>{render(row)}</Td>
                ))}
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
      {data.count > 0 ? (
        <PulpPagination
          params={params}
          updateParams={updateParams}
          count={data.count}
          perPageOptions={PAGE_SIZES}
        />
      ) : null}
    </>
  );
}
