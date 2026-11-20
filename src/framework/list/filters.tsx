import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { ToolbarGroup, ToolbarItem } from '@patternfly/react-core';
import { useMemo, useState } from 'react';
import { AppliedFilters, CompoundFilter } from 'src/components';
import type { FilterOption } from 'src/components/compound-filter';
import type { RemoteBase } from 'src/entities/plugin/model';
import { useEntity, useEntityList } from 'src/entities/plugin/queries';
import type { RemoteEntity } from 'src/entities/plugin/remote';
import type { FilterDef } from '../descriptor';
import { joinTerms, splitTerms } from '../labels/label-select';
import { useSettled } from '../use-settled';
import { LabelFilter } from './label-filter';
import type { ListParams } from './list-params';

// The address's filter that holds a label expression, and the one that holds
// the address of a remote.
const LABEL_PARAM = 'pulp_label_select';
const REMOTE_PARAM = 'remote';

const PAGE_PARAMS = ['page_size', 'page', 'sort'];

// How many remotes the remote filter offers at a time; the text typed narrows
// them on the server.
const REMOTE_CHOICES = 20;

// How long typing pauses before the remotes are searched for the text.
const SEARCH_PAUSE_MS = 250;

// The remotes of the plugin, as far as the filters read them.
export type FilterRemotes = RemoteEntity<RemoteBase, never, never>;

// What the remote reads are given when a list has no remote filter: they are
// switched off and nothing is ever asked of it.
const NO_REMOTES = {
  app: 'none',
  object: 'remote',
  list: () => Promise.reject(new Error('The plugin has no remotes to list')),
  retrieve: () =>
    Promise.reject(new Error('The plugin has no remotes to retrieve')),
} as unknown as FilterRemotes;

interface FiltersProps {
  // The filters the plugin's descriptor declares.
  filters: readonly FilterDef[];
  params: ListParams;
  // Writes the list's address. A filter change starts from the first page.
  updateParams: (next: object) => void;
  // The label keys offered while a key is typed.
  labelKeys: readonly string[];
  // The server's reason for refusing the current label expression, or null.
  labelRefusal: string | null;
  // Called when the label filter opens.
  onLabelFilterOpen: () => void;
  // The plugin's remotes, for the remote filter.
  remotes?: FilterRemotes;
}

// The value of a filter as text, or undefined when it is not set.
const textOf = (params: ListParams, param: string): string | undefined => {
  const value = params[param];
  return value === undefined ? undefined : String(value);
};

// The filter inputs of a list, from the descriptor's filters: a search box
// with a choice of the text filters and of the remote filter, and the label
// filter. Each filter writes its value into the address and the list reads it
// from there, so a filtered list can be linked to and survives a reload.
export const ListFilters = ({
  filters,
  params,
  updateParams,
  labelKeys,
  labelRefusal,
  onLabelFilterOpen,
  remotes,
}: FiltersProps) => {
  const [inputText, setInputText] = useState('');
  const [chosen, setChosen] = useState<string | undefined>(undefined);

  // The remotes are searched for the text typed, on the server, and only while
  // the remote filter is the one in use.
  const remoteParam = filters.find(({ kind }) => kind === 'remote')?.param;
  const searching = remoteParam !== undefined && chosen === remoteParam;
  const search = useSettled(inputText.trim(), SEARCH_PAUSE_MS);
  const found = useEntityList(
    remotes ?? NO_REMOTES,
    {
      ...(search ? { name__icontains: search } : {}),
      page_size: REMOTE_CHOICES,
      sort: 'name',
      fields: ['pulp_href', 'name'],
    },
    { enabled: remotes !== undefined && searching },
  );

  const searchFilters = useMemo<FilterOption[]>(
    () =>
      filters.flatMap(({ kind, param, label }) => {
        if (kind === 'text') {
          return [{ id: param, title: i18n._(label) }];
        }
        if (kind === 'remote' && remotes !== undefined) {
          return [
            {
              id: param,
              title: i18n._(label),
              inputType: 'typeahead' as const,
              options: [
                { id: 'null', title: t`None` },
                ...(found.data?.results ?? []).map((remote) => ({
                  id: remote.pulp_href,
                  title: remote.name,
                })),
              ],
            },
          ];
        }
        return [];
      }),
    [filters, remotes, found.data],
  );
  const labelFilter = filters.find(({ param }) => param === LABEL_PARAM);

  return (
    <ToolbarGroup variant='filter-group'>
      {searchFilters.length > 0 ? (
        <ToolbarItem>
          <CompoundFilter
            filterConfig={searchFilters}
            inputText={inputText}
            onChange={setInputText}
            params={params}
            selectFilter={setChosen}
            updateParams={updateParams}
          />
        </ToolbarItem>
      ) : null}
      {labelFilter ? (
        <ToolbarItem>
          <LabelFilter
            expression={textOf(params, LABEL_PARAM)}
            suggestions={labelKeys}
            refusal={labelRefusal}
            onOpen={onLabelFilterOpen}
            onApply={(expression) => {
              const rest = Object.fromEntries(
                Object.entries(params).filter(([key]) => key !== LABEL_PARAM),
              );
              updateParams(
                expression === undefined
                  ? { ...rest, page: 1 }
                  : { ...rest, [LABEL_PARAM]: expression, page: 1 },
              );
            }}
          />
        </ToolbarItem>
      ) : null}
    </ToolbarGroup>
  );
};

interface ChipsProps {
  filters: readonly FilterDef[];
  params: ListParams;
  updateParams: (next: object) => void;
  remotes?: FilterRemotes;
}

// The filters that are set, as chips that remove them one by one. A label
// expression shows one chip per term, so one condition can go while the others
// stay, and a remote shows by its name.
export const FilterChips = ({
  filters,
  params,
  updateParams,
  remotes,
}: ChipsProps) => {
  const remoteAddress = textOf(params, REMOTE_PARAM);
  const remote = useEntity(
    remotes ?? NO_REMOTES,
    remoteAddress && remoteAddress !== 'null' ? remoteAddress : null,
    { enabled: remotes !== undefined },
  );

  const shown = {
    ...params,
    ...(typeof params[LABEL_PARAM] === 'string'
      ? { [LABEL_PARAM]: splitTerms(params[LABEL_PARAM]) }
      : {}),
  } as Record<string, string | number | string[]>;

  // The chips hand back the filters with a term fewer, as a list of terms.
  const change = (next: Record<string, string | number | string[]>) => {
    const { [LABEL_PARAM]: terms, ...rest } = next;
    const expression = Array.isArray(terms) ? joinTerms(terms) : terms;
    updateParams(
      expression === undefined || expression === ''
        ? rest
        : { ...rest, [LABEL_PARAM]: expression },
    );
  };

  return (
    <AppliedFilters
      updateParams={(next) => change(next)}
      params={shown}
      ignoredParams={PAGE_PARAMS}
      niceNames={Object.fromEntries(
        filters.map(({ param, label }) => [param, i18n._(label)]),
      )}
      niceValues={{
        [REMOTE_PARAM]: {
          null: t`None`,
          ...(remoteAddress && remote.data
            ? { [remoteAddress]: remote.data.name }
            : {}),
        },
      }}
    />
  );
};
