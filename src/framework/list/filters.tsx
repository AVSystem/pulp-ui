import { i18n } from '@lingui/core';
import { ToolbarGroup, ToolbarItem } from '@patternfly/react-core';
import { useMemo, useState } from 'react';
import { AppliedFilters, CompoundFilter } from 'src/components';
import type { FilterOption } from 'src/components/compound-filter';
import type { FilterDef } from '../descriptor';
import { joinTerms, splitTerms } from '../labels/label-select';
import { LabelFilter } from './label-filter';
import type { ListParams } from './list-params';

// The address's filter that holds a label expression.
const LABEL_PARAM = 'pulp_label_select';

const PAGE_PARAMS = ['page_size', 'page', 'sort'];

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
}

// The value of a filter as text, or undefined when it is not set.
const textOf = (params: ListParams, param: string): string | undefined => {
  const value = params[param];
  return value === undefined ? undefined : String(value);
};

// The filter inputs of a list, from the descriptor's filters: a search box
// with a choice of the text filters, and the label filter. Each filter writes
// its value into the address and the list reads it from there, so a filtered
// list can be linked to and survives a reload.
export const ListFilters = ({
  filters,
  params,
  updateParams,
  labelKeys,
  labelRefusal,
}: FiltersProps) => {
  const [inputText, setInputText] = useState('');

  const searchFilters = useMemo<FilterOption[]>(
    () =>
      filters
        .filter(({ kind }) => kind === 'text')
        .map(({ param, label }) => ({
          id: param,
          title: i18n._(label),
        })),
    [filters],
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
}

// The filters that are set, as chips that remove them one by one. A label
// expression shows one chip per term, so one condition can go while the others
// stay.
export const FilterChips = ({ filters, params, updateParams }: ChipsProps) => {
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
    />
  );
};
