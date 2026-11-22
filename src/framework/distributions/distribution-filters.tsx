import { i18n } from '@lingui/core';
import { msg, t } from '@lingui/core/macro';
import { Switch, ToolbarGroup, ToolbarItem } from '@patternfly/react-core';
import { useState } from 'react';
import { AppliedFilters, CompoundFilter } from 'src/components';
import type { FilterOption } from 'src/components/compound-filter';
import {
  DISTRIBUTION_TYPES,
  type DistributionPlugin,
} from 'src/entities/core/distribution/page';
import type { FilterDef } from '../descriptor';
import { joinTerms, splitTerms } from '../labels/label-select';
import { LabelFilter } from '../list/label-filter';
import type { ListParams } from '../list/list-params';
import { pluginLabel } from './plugin-label';

// The filters of the list of every distribution, by the query parameter each
// one is held in, in the address. The plugin filter holds the chosen plugins,
// separated by commas, and the public filter holds `true`; the others are the
// parameters of the server's own filters.
export const PLUGIN_PARAM = 'plugin';
export const PUBLIC_PARAM = 'public';
const NAME_PARAM = 'name__icontains';
const BASE_PATH_PARAM = 'base_path__icontains';
const LABEL_PARAM = 'pulp_label_select';

export const DISTRIBUTION_FILTERS: FilterDef[] = [
  { id: 'plugin', label: msg`Plugin`, param: PLUGIN_PARAM, kind: 'select' },
  { id: 'name', label: msg`Name`, param: NAME_PARAM, kind: 'text' },
  {
    id: 'base-path',
    label: msg`Base path`,
    param: BASE_PATH_PARAM,
    kind: 'text',
  },
  { id: 'labels', label: msg`Labels`, param: LABEL_PARAM, kind: 'labels' },
  {
    id: 'public',
    label: msg`Public only`,
    param: PUBLIC_PARAM,
    kind: 'select',
  },
];

const PLUGINS = Object.keys(DISTRIBUTION_TYPES) as DistributionPlugin[];

// The plugins the address chooses among those that can be listed, in the order
// of the plugins. A name that is not one of them is ignored, and a choice that
// leaves none is no choice.
export function chosenPlugins(
  params: ListParams,
  installed: readonly DistributionPlugin[],
): DistributionPlugin[] {
  const named = String(params[PLUGIN_PARAM] ?? '').split(',');

  return installed.filter((plugin) => named.includes(plugin));
}

// Whether the address asks for the distributions that have no content guard.
export function publicOnlyOf(params: ListParams): boolean {
  return params[PUBLIC_PARAM] === 'true';
}

// The plugins the list reads: the ones chosen, or every one that can be listed
// when none is.
export function listedPlugins(
  params: ListParams,
  installed: readonly DistributionPlugin[],
): DistributionPlugin[] {
  const chosen = chosenPlugins(params, installed);

  return chosen.length > 0 ? chosen : [...installed];
}

// The parameters of the address without the named ones.
function without(params: ListParams, ...names: string[]): ListParams {
  return Object.fromEntries(
    Object.entries(params).filter(([key]) => !names.includes(key)),
  ) as ListParams;
}

// What the filter controls and chips read of the address: the plugin filter as
// the list of plugins chosen, and a value that is no filter left out.
function shownParams(
  params: ListParams,
  installed: readonly DistributionPlugin[],
): Record<string, string | number | string[]> {
  const rest = without(params, PLUGIN_PARAM, PUBLIC_PARAM);
  const chosen = chosenPlugins(params, installed);

  return {
    ...rest,
    ...(chosen.length > 0 ? { [PLUGIN_PARAM]: chosen } : {}),
    ...(publicOnlyOf(params) ? { [PUBLIC_PARAM]: 'true' } : {}),
  };
}

// The address a change of the shown filters stands for: the chosen plugins
// written in the order of the plugins, and none written as no filter.
function addressOf(
  next: Record<string, string | number | string[]>,
): ListParams {
  const { [PLUGIN_PARAM]: plugins, ...rest } = next;
  const names = Array.isArray(plugins)
    ? PLUGINS.filter((plugin) => plugins.includes(plugin))
    : [];

  return {
    ...rest,
    ...(names.length > 0 ? { [PLUGIN_PARAM]: names.join(',') } : {}),
  } as ListParams;
}

interface FiltersProps {
  params: ListParams;
  // Writes the list's address. A filter change starts from the first page.
  updateParams: (next: object) => void;
  // The plugins whose distributions can be listed.
  installed: readonly DistributionPlugin[];
  // The label keys offered while a key is typed.
  labelKeys: readonly string[];
  // The server's reason for refusing the current label expression, or null.
  labelRefusal: string | null;
  // Called when the label filter opens.
  onLabelFilterOpen?: () => void;
}

// The filter bar of the list of every distribution: a search box with a choice
// of the name, the base path and the plugins, the label filter, and the switch
// that keeps only the distributions that have no content guard. Each writes its
// value into the address, and the list reads it from there, so a filtered list
// can be linked to and survives a reload.
export const DistributionFilters = ({
  params,
  updateParams,
  installed,
  labelKeys,
  labelRefusal,
  onLabelFilterOpen,
}: FiltersProps) => {
  const [inputText, setInputText] = useState('');

  const searchFilters: FilterOption[] = [
    { id: NAME_PARAM, title: t`Name`, placeholder: t`Filter by name` },
    {
      id: BASE_PATH_PARAM,
      title: t`Base path`,
      placeholder: t`Filter by base path`,
    },
    ...(installed.length > 1
      ? [
          {
            id: PLUGIN_PARAM,
            title: t`Plugin`,
            inputType: 'multiple' as const,
            options: installed.map((plugin) => ({
              id: plugin,
              title: pluginLabel(plugin),
            })),
          },
        ]
      : []),
  ];

  return (
    <ToolbarGroup variant='filter-group'>
      <ToolbarItem>
        <CompoundFilter
          filterConfig={searchFilters}
          inputText={inputText}
          onChange={setInputText}
          params={shownParams(params, installed)}
          updateParams={(next) => updateParams(addressOf(next))}
        />
      </ToolbarItem>
      <ToolbarItem>
        <LabelFilter
          expression={
            typeof params[LABEL_PARAM] === 'string'
              ? params[LABEL_PARAM]
              : undefined
          }
          suggestions={labelKeys}
          refusal={labelRefusal}
          onOpen={onLabelFilterOpen}
          onApply={(expression) => {
            const rest = without(params, LABEL_PARAM);
            updateParams(
              expression === undefined
                ? { ...rest, page: 1 }
                : { ...rest, [LABEL_PARAM]: expression, page: 1 },
            );
          }}
        />
      </ToolbarItem>
      <ToolbarItem alignSelf='center'>
        <Switch
          id='distribution-public-only'
          label={t`Public only`}
          isChecked={publicOnlyOf(params)}
          onChange={(_event, checked) => {
            const rest = without(params, PUBLIC_PARAM);
            updateParams(
              checked
                ? { ...rest, [PUBLIC_PARAM]: 'true', page: 1 }
                : { ...rest, page: 1 },
            );
          }}
        />
      </ToolbarItem>
    </ToolbarGroup>
  );
};

interface ChipsProps {
  params: ListParams;
  updateParams: (next: object) => void;
  installed: readonly DistributionPlugin[];
}

const PAGE_PARAMS = ['page_size', 'page', 'sort'];

// The filters that are set, as chips that remove them one by one: a chip for
// each chosen plugin, for each term of a label expression, and one for the
// public filter.
export const DistributionFilterChips = ({
  params,
  updateParams,
  installed,
}: ChipsProps) => {
  const shown = shownParams(params, installed);
  const labels = params[LABEL_PARAM];
  if (typeof labels === 'string') {
    shown[LABEL_PARAM] = splitTerms(labels);
  }

  // The chips hand back the filters with a value fewer.
  const change = (next: Record<string, string | number | string[]>) => {
    const { [LABEL_PARAM]: terms, ...rest } = next;
    const expression = Array.isArray(terms) ? joinTerms(terms) : terms;
    const address = addressOf(rest);
    updateParams(
      expression === undefined || expression === ''
        ? address
        : { ...address, [LABEL_PARAM]: expression },
    );
  };

  return (
    <AppliedFilters
      updateParams={(next) => change(next)}
      params={shown}
      ignoredParams={PAGE_PARAMS}
      niceNames={Object.fromEntries(
        DISTRIBUTION_FILTERS.map(({ param, label }) => [param, i18n._(label)]),
      )}
      niceValues={{
        [PLUGIN_PARAM]: Object.fromEntries(
          PLUGINS.map((plugin) => [plugin, pluginLabel(plugin)]),
        ),
        [PUBLIC_PARAM]: { true: t`Yes` },
      }}
    />
  );
};
