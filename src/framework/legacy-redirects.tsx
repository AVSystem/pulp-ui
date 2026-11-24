import type { ReactElement } from 'react';
import { Navigate, useLocation, useParams } from 'react-router';
import type { FrameworkPlugin, PluginManifest } from './manifest';
import {
  type LegacyPattern,
  type RepositoryTab,
  legacyPatternsOf,
  newRemotePath,
  newRepositoryPath,
  remoteEditPath,
  remotePath,
  repositoryEditPath,
  repositoryPath,
  versionPath,
} from './route-patterns';

// The query parameters of the old repository detail address that named a tab
// and a version. The new address says both in its path, so they are not kept.
const TAB_PARAMETER = 'tab';
const VERSION_PARAMETER = 'repositoryVersion';

// The tab of the old detail address, spelled the way the old tab strip did,
// and the sub-path of the new address it moves to. Anything else, including no
// tab at all, is the details tab.
const TABS: Record<string, RepositoryTab> = {
  'repository-versions': 'versions',
  distributions: 'distributions',
  packages: 'content',
};

// A version number is a whole number written in digits only; anything else in
// the parameter is ignored rather than put into an address.
function versionNumber(value: string | null): number | null {
  if (value === null || !/^\d{1,15}$/.test(value)) {
    return null;
  }
  return Number(value);
}

interface Target {
  pathname: string;
  search: string;
}

// Where an old address leads. The path is built only from the route's own
// parameter and the route patterns, each name encoded into one segment; the
// query string is kept apart from the parameters the path now carries. Nothing
// in the query decides where the user goes.
function targetOf(
  plugin: FrameworkPlugin,
  { screen }: LegacyPattern,
  name: string | undefined,
  search: string,
): Target {
  const query = new URLSearchParams(search);
  const rest = () => (query.size > 0 ? `?${query.toString()}` : '');

  switch (screen) {
    case 'repository-detail': {
      const tab = TABS[query.get(TAB_PARAMETER) ?? ''];
      const version =
        tab === 'versions' ? versionNumber(query.get(VERSION_PARAMETER)) : null;
      query.delete(TAB_PARAMETER);
      query.delete(VERSION_PARAMETER);

      return {
        pathname:
          version !== null
            ? versionPath(plugin, name as string, version)
            : repositoryPath(plugin, name as string, tab),
        search: rest(),
      };
    }
    case 'repository-packages':
      return {
        pathname: repositoryPath(plugin, name as string, 'content'),
        search: rest(),
      };
    case 'repository-edit':
      return {
        pathname: repositoryEditPath(plugin, name as string),
        search: rest(),
      };
    case 'repository-create':
      return { pathname: newRepositoryPath(plugin), search: rest() };
    case 'remote-detail':
      return { pathname: remotePath(plugin, name as string), search: rest() };
    case 'remote-edit':
      return {
        pathname: remoteEditPath(plugin, name as string),
        search: rest(),
      };
    default:
      return { pathname: newRemotePath(plugin), search: rest() };
  }
}

function LegacyRedirect({
  plugin,
  pattern,
}: {
  plugin: FrameworkPlugin;
  pattern: LegacyPattern;
}) {
  const { name } = useParams();
  const { search } = useLocation();

  // The history entry is replaced, so Back does not return to the old address
  // and be sent forward again.
  return <Navigate replace to={targetOf(plugin, pattern, name, search)} />;
}

export interface LegacyRedirectRoute {
  element: ReactElement;
  path: string;
}

// The routes that move the addresses the screens had before they were
// described by a descriptor to the addresses they have now. The caller passes
// the plugins that are on the framework; a plugin gets redirects only for the
// kinds of object whose screens are on it. The redirect itself needs no session:
// the screen it leads to asks for one, and then returns to the new address.
export function legacyRedirectRoutes(
  manifests: readonly PluginManifest[],
): LegacyRedirectRoute[] {
  return manifests.flatMap(({ plugin, resources }) =>
    legacyPatternsOf(plugin, resources).map((pattern) => ({
      path: pattern.pattern,
      element: <LegacyRedirect plugin={plugin} pattern={pattern} />,
    })),
  );
}
