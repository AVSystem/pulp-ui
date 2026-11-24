import { i18n } from '@lingui/core';
import type { MessageDescriptor } from '@lingui/core';
import { msg, t } from '@lingui/core/macro';
import {
  Button,
  Content,
  ToggleGroup,
  ToggleGroupItem,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
} from '@patternfly/react-core';
import { Tbody, Td, Tr } from '@patternfly/react-table';
import type { ReactNode } from 'react';
import { Suspense, lazy, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  type AlertType,
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
import type { RepositoryBase } from 'src/entities/plugin/model';
import { useEntityList } from 'src/entities/plugin/queries';
import {
  isSessionEnd,
  requestErrorDescription,
} from 'src/utilities/request-error';
import { selectedText } from '../bulk/bulk-menu';
import { SelectCell } from '../bulk/select-cells';
import { usePageSelection } from '../bulk/selection';
import { ContentLabels } from '../content/content-labels';
import { RemoveContentDialog } from '../content/remove-content-dialog';
import {
  type ContentTypeDef,
  type PluginDescriptor,
  type TabDef,
  repositoryOf,
} from '../descriptor';
import {
  type ListParams,
  PAGE_SIZES,
  paramsOfAddress,
  searchOf,
} from '../list/list-params';
import type { FrameworkPlugin } from '../manifest';
import { useRepositoryPermission } from './use-repository-permission';

// The upload dialog is loaded when it is first opened.
const UploadDialog = lazy(() =>
  import('../content/upload-dialog').then((module) => ({
    default: module.UploadDialog,
  })),
);

// The dialog browses another repository's content through the list below, so it
// is loaded when it is first opened and the two modules never need each other
// at load time.
const AddContentDialog = lazy(() =>
  import('../content/add-content-dialog').then((module) => ({
    default: module.AddContentDialog,
  })),
);

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
  // Filters every request of the list carries whatever the address says: the
  // list of one content type through an endpoint that holds several.
  fixed?: Readonly<Record<string, string>>;
  // What names a unit to the user, in a check box and in a confirmation: the
  // path of a file, the name and version of a package. The address of the unit
  // when a type names nothing.
  nameOf?: (row: Row) => string;
}

// What a list does with the rows its user ticks: the toolbar items of the
// actions that take the ticked rows, in the order of the page. `clear` empties
// the selection, for an action that has been accepted.
export interface ContentSelecting<Row> {
  actions: (picked: readonly Row[], clear: () => void) => ReactNode;
}

// Which part of a repository version a list shows: the content the version
// holds, what it added to the version before it or what it removed.
export type VersionSection = 'present' | 'added' | 'removed';

const FILTER_OF_SECTION = {
  present: 'repository_version',
  added: 'repository_version_added',
  removed: 'repository_version_removed',
} as const;

// Where a list keeps its page, order and filters when the address is not its
// to use: a page of several lists keeps each one's own.
export interface ListAddress {
  search: string;
  onChange: (search: string) => void;
}

interface Props<Row extends { pulp_href: string }> {
  config: ContentListConfig<Row>;
  // The address of the repository version whose content is listed, or none for
  // a repository that has no version yet. Without one nothing is read: the
  // server would list the content of every repository.
  version: string | null | undefined;
  // Lists every unit of the type the user may see, whatever repository holds
  // it, and ignores the version. No filter is added that would claim more or
  // less than the server returns for the user.
  unscoped?: boolean;
  // What of the version is listed; the content it holds unless said.
  section?: VersionSection;
  // The name of the table for assistive technology, in place of the config's.
  label?: string;
  // Where the page, order and filters live; the address of the screen unless
  // said.
  address?: ListAddress;
  // Gives the rows check boxes, for the page only, and the actions the user may
  // take on the ticked rows. Rows have none unless said.
  selecting?: ContentSelecting<Row>;
  // Shows the labels of each unit, with the editor for a user who may change
  // them, and filters the list by labels. The list reads the labels with the
  // rows.
  labelled?: boolean;
}

// The content of one repository version as a page of a table. The page, its
// size, the order and the filters are what the address says, so a page can be
// shared and the back button works. Every read is one request for the page.
export function ContentList<Row extends { pulp_href: string }>({
  config,
  version,
  unscoped = false,
  section = 'present',
  label,
  address,
  selecting,
  labelled = false,
}: Props<Row>) {
  const { entity, defaultPageSize, defaultSort, fixed } = config;
  // A labelled list adds the labels to what the config declares: the field the
  // server reads them from, a column that shows them and a filter by selector.
  const fields = useMemo(
    () => (labelled ? [...config.fields, 'pulp_labels'] : config.fields),
    [labelled, config.fields],
  );
  const columns = useMemo<readonly ContentColumn<Row>[]>(
    () =>
      labelled
        ? [
            ...config.columns,
            {
              id: 'labels',
              label: msg`Labels`,
              render: (row) => (
                <ContentLabels
                  row={row}
                  name={config.nameOf?.(row) ?? row.pulp_href}
                  entity={entity as ContentEntity<unknown>}
                />
              ),
            },
          ]
        : config.columns,
    [labelled, config.columns, config.nameOf, entity],
  );
  const filters = useMemo<readonly ContentFilter[]>(
    () =>
      labelled
        ? [
            ...config.filters,
            { param: 'pulp_label_select', label: msg`Labels` },
          ]
        : config.filters,
    [labelled, config.filters],
  );
  const location = useLocation();
  const navigate = useNavigate();
  const search = address ? address.search : location.search;
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
  const updateParams = (next: object) => {
    const to = searchOf(next as ListParams, options);
    if (address) {
      address.onChange(to);
    } else {
      navigate({ search: to });
    }
  };

  const request = {
    ...params,
    ...fixed,
    ...(unscoped ? {} : { [FILTER_OF_SECTION[section]]: version ?? '' }),
    fields: [...fields],
  } as ContentListParams;
  const query = useEntityList(entity, request, {
    enabled: unscoped || !!version,
  });

  // The rows ticked for an action: those of this page of this list, and none
  // once the address, the version or the part changes.
  const rows = query.data?.results;
  const shownHrefs = useMemo(
    () => (rows ?? []).map(({ pulp_href }) => pulp_href),
    [rows],
  );
  const selection = usePageSelection(
    `${version}|${section}|${search}`,
    shownHrefs,
  );
  const { selected } = selection;
  const picked = useMemo(
    () => (rows ?? []).filter(({ pulp_href }) => selected.has(pulp_href)),
    [rows, selected],
  );
  const nameOf = (row: Row) => config.nameOf?.(row) ?? row.pulp_href;

  if (!unscoped && !version) {
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
            {selecting ? (
              <ToolbarGroup>
                <ToolbarItem>
                  <Content component='small' aria-live='polite'>
                    {picked.length > 0
                      ? selectedText(picked.length)
                      : t`No rows selected`}
                  </Content>
                </ToolbarItem>
                <ToolbarItem>
                  {selecting.actions(picked, selection.clear)}
                </ToolbarItem>
              </ToolbarGroup>
            ) : null}
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
        <Table aria-label={label ?? i18n._(config.title)}>
          <SortTable
            options={{ headers }}
            params={params}
            updateParams={updateParams}
            selectAll={
              selecting
                ? {
                    isSelected: selection.allSelected
                      ? true
                      : selection.count > 0
                        ? null
                        : false,
                    onSelect: selection.toggleAll,
                    label: t`Select all on this page`,
                  }
                : undefined
            }
          />
          <Tbody>
            {data.results.map((row, position) => (
              <Tr
                key={row.pulp_href}
                isRowSelected={selected.has(row.pulp_href)}
              >
                {selecting ? (
                  <SelectCell
                    id={`content-select-${position}`}
                    label={t`Select ${nameOf(row)}`}
                    checked={selected.has(row.pulp_href)}
                    onChange={(checked) =>
                      selection.toggle(row.pulp_href, checked)
                    }
                  />
                ) : null}
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

// What a ContentList of a plugin's content type is configured with. The texts
// are the type's own, with a plain wording for a type that gives none.
export function tabConfig(
  type: ContentTypeDef,
): ContentListConfig<{ pulp_href: string }> {
  return {
    entity: type.entity,
    fields: type.fields,
    columns: type.columns,
    filters: type.filters ?? [],
    title: type.label,
    errorTitle: type.errorTitle ?? msg`Content could not be displayed.`,
    emptyTitle: type.emptyTitle ?? msg`No content in the latest version`,
    emptyDescription:
      type.emptyDescription ?? msg`There is no content of this kind to show.`,
    defaultPageSize: 20,
    defaultSort: type.defaultSort,
    nameOf: type.nameOf,
  };
}

// The query parameter that names the content type on a screen whose plugin
// declares several.
const TYPE_PARAMETER = 'type';

// The content type a screen shows and the address its list keeps its page,
// order and filters in. The type is named in the address beside them, so it is
// never lost when the list pages or sorts; the first type is the default and
// leaves the address clean.
export function useContentType(types: readonly ContentTypeDef[]) {
  const location = useLocation();
  const navigate = useNavigate();

  const address = new URLSearchParams(location.search);
  const named = address.get(TYPE_PARAMETER);
  const type = types.find(({ id }) => id === named) ?? types[0];
  address.delete(TYPE_PARAMETER);

  const listAddress: ListAddress = {
    search: address.size > 0 ? `?${address.toString()}` : '',
    onChange: (search) => {
      const next = new URLSearchParams(search);
      if (type !== types[0]) {
        next.set(TYPE_PARAMETER, type.id);
      }
      navigate({ search: next.size > 0 ? `?${next.toString()}` : '' });
    },
  };

  return { type, listAddress };
}

// The choice between the content types a plugin declares. Choosing one starts
// its list afresh: nothing of the other's page and filters is carried over.
export const ContentTypeChoice = ({
  types,
  type,
}: {
  types: readonly ContentTypeDef[];
  type: ContentTypeDef;
}) => {
  const navigate = useNavigate();

  return (
    <ToggleGroup aria-label={t`Content type`}>
      {types.map(({ id, label }) => (
        <ToggleGroupItem
          key={id}
          text={i18n._(label)}
          buttonId={`content-type-${id}`}
          isSelected={id === type.id}
          onChange={() =>
            navigate({
              search:
                id === types[0].id
                  ? ''
                  : `?${TYPE_PARAMETER}=${encodeURIComponent(id)}`,
            })
          }
        />
      ))}
    </ToggleGroup>
  );
};

interface TabProps {
  plugin: FrameworkPlugin;
  descriptor: PluginDescriptor;
  repository: RepositoryBase;
  addAlert: (alert: AlertType) => void;
}

// The content of a repository's latest version, one kind of content at a time
// (a choice between them when the plugin declares several). A user who may
// modify the repository ticks rows of the current page and removes them in one
// request after a confirmation; the list shows the new version when the task
// that makes it has ended. A repository without a version holds nothing, and
// nothing is asked of the server.
export const ContentTab = ({
  plugin,
  descriptor,
  repository,
  addAlert,
}: TabProps) => {
  const types = descriptor.contentTypes ?? [];
  if (types.length === 0) {
    throw new Error(
      'The descriptor declares no content type, which the Content tab needs',
    );
  }
  const { entity } = repositoryOf(descriptor);
  const mayModify = useRepositoryPermission(plugin, repository, 'modify');
  const [adding, setAdding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<{
    rows: { href: string; name: string }[];
    clear: () => void;
  } | null>(null);

  const { type, listAddress } = useContentType(types);

  const config = tabConfig(type);
  const canRemove = mayModify && entity.modify !== undefined;
  const upload = descriptor.repository?.upload;
  const canUpload = canRemove && upload !== undefined;

  return (
    <>
      {types.length > 1 || canRemove ? (
        <Toolbar>
          <ToolbarContent>
            {types.length > 1 ? (
              <ToolbarItem>
                <ContentTypeChoice types={types} type={type} />
              </ToolbarItem>
            ) : null}
            {canRemove ? (
              <ToolbarItem align={{ default: 'alignEnd' }}>
                <Button variant='primary' onClick={() => setAdding(true)}>
                  {t`Add content`}
                </Button>
              </ToolbarItem>
            ) : null}
            {canUpload ? (
              <ToolbarItem>
                <Button variant='secondary' onClick={() => setUploading(true)}>
                  {t`Upload`}
                </Button>
              </ToolbarItem>
            ) : null}
          </ToolbarContent>
        </Toolbar>
      ) : null}
      <ContentList
        key={type.id}
        config={config}
        version={repository.latest_version_href}
        address={listAddress}
        labelled={type.entity.setLabel !== undefined}
        selecting={
          canRemove
            ? {
                actions: (picked, clear) => (
                  <Button
                    variant='secondary'
                    isDanger
                    isDisabled={picked.length === 0}
                    onClick={() =>
                      setRemoving({
                        rows: picked.map((row) => ({
                          href: row.pulp_href,
                          name: config.nameOf?.(row) ?? row.pulp_href,
                        })),
                        clear,
                      })
                    }
                  >
                    {t`Remove from repository`}
                  </Button>
                ),
              }
            : undefined
        }
      />
      {adding ? (
        <Suspense fallback={null}>
          <AddContentDialog
            repository={repository}
            entity={entity}
            types={types}
            addAlert={addAlert}
            onClose={() => setAdding(false)}
          />
        </Suspense>
      ) : null}
      {uploading && upload ? (
        <Suspense fallback={null}>
          <UploadDialog
            repository={repository}
            entity={entity}
            types={types}
            upload={upload}
            onClose={() => setUploading(false)}
          />
        </Suspense>
      ) : null}
      {removing ? (
        <RemoveContentDialog
          repository={repository}
          entity={entity}
          items={removing.rows}
          addAlert={addAlert}
          onRemoved={removing.clear}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </>
  );
};

// The Content tab as a plugin declares it among its tabs.
export const contentTab = <Row extends RepositoryBase>(): TabDef<Row> => ({
  id: 'content',
  label: msg`Content`,
  render: ({ repository, plugin, descriptor, addAlert }) => (
    <ContentTab
      plugin={plugin}
      descriptor={descriptor}
      repository={repository}
      addAlert={addAlert}
    />
  ),
});
