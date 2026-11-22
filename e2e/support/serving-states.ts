import type { DistributionPlugin } from './distribution-screens';

// The distributions the lab keeps so that every state a distribution can serve
// in has a real object: `zz-synth-serving-<plugin>-<state>`, each with a
// repository of the same name. Specs read them and never change them. For each
// one the table says what the screens show: the text of the "Served state"
// cell of the list, and the label that stands beside the address on the
// distribution's page and on the repository's Distributions tab (null when the
// state draws none).

export interface ServingState {
  plugin: DistributionPlugin;
  state: string;
  name: string;
  // the "Served state" cell of the list
  served: string;
  // the label beside the address, or null when there is none
  warning: string | null;
  // whether the repository's Distributions tab lists it: the plugin has such a
  // tab and the distribution serves the repository
  onTab: boolean;
}

export const NOT_BOUND = 'Not bound to anything';
export const NOTHING = 'Serves nothing (404): no publication';
export const STALE = 'Serves version 1, latest is 2';
export const CANNOT_CHECK = 'Cannot be checked';
export const DEPRECATED = 'Bound to a deprecated publication';

// Every label a distribution's page may draw beside its address, so a state
// that draws none can be checked against all of them.
export const ALL_WARNINGS = [
  NOT_BOUND,
  NOTHING,
  STALE,
  CANNOT_CHECK,
  DEPRECATED,
];

const name = (plugin: DistributionPlugin, state: string) =>
  `zz-synth-serving-${plugin}-${state}`;

function state(
  plugin: DistributionPlugin,
  stateName: string,
  served: string,
  warning: string | null,
  onTab = false,
): ServingState {
  return {
    plugin,
    state: stateName,
    name: name(plugin, stateName),
    served,
    warning,
    onTab,
  };
}

// What the administrator is shown.
export const ADMIN_STATES: ServingState[] = [
  state('file', 'repo-fresh', 'Served', null, true),
  state('file', 'repo-stale', STALE, STALE, true),
  state('file', 'repo-404', NOTHING, NOTHING, true),
  state('file', 'pub-fresh', 'Served', null, true),
  state('file', 'pub-stale', STALE, STALE, true),
  state('file', 'version-pub', 'Served', null, true),
  state('file', 'version-nopub', NOTHING, NOTHING, true),
  state('file', 'none', NOT_BOUND, NOT_BOUND),
  state('file', 'public', 'Served', null, true),
  state('file', 'guarded', 'Served', null, true),
  ...(['deb', 'rpm'] as const).flatMap((plugin) => [
    state(plugin, 'repo-fresh', 'Served', null, true),
    state(plugin, 'repo-stale', STALE, STALE, true),
    state(plugin, 'repo-404', NOTHING, NOTHING, true),
  ]),
  state('python', 'repo', 'Not applicable', null, true),
  state('python', 'pub', DEPRECATED, DEPRECATED, true),
  ...(['maven', 'npm', 'ansible', 'container'] as const).map((plugin) =>
    state(plugin, 'repo', 'Not applicable', null),
  ),
];

// What the viewer is shown. The viewer reads file distributions and the
// container one and no publication of any plugin, so what depends on the
// publications cannot be told: it says so instead of claiming the
// distribution serves nothing or is out of date. A state that does not depend
// on them is told to everyone.
const NEEDS_PUBLICATIONS = new Set([
  'repo-fresh',
  'repo-stale',
  'repo-404',
  'version-pub',
  'version-nopub',
  'public',
  'guarded',
]);

export const VIEWER_STATES: ServingState[] = ADMIN_STATES.filter(
  ({ plugin }) => plugin === 'file' || plugin === 'container',
).map((entry) =>
  entry.plugin === 'file' && NEEDS_PUBLICATIONS.has(entry.state)
    ? { ...entry, served: CANNOT_CHECK, warning: CANNOT_CHECK }
    : entry.plugin === 'file' &&
        (entry.state === 'pub-fresh' || entry.state === 'pub-stale')
      ? // bound to one publication: it serves that one whoever asks. The
        // repository's tab finds such a distribution through the repository's
        // publications, which the viewer may not read, so it is not listed
        // there.
        { ...entry, served: 'Served', warning: null, onTab: false }
      : entry,
);
