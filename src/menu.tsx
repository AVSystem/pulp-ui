import { t } from '@lingui/core/macro';
import {
  Button,
  Nav,
  NavExpandable,
  NavGroup,
  NavItem,
} from '@patternfly/react-core';
import CloudDownloadAltIcon from '@patternfly/react-icons/dist/esm/icons/cloud-download-alt-icon';
import CubeIcon from '@patternfly/react-icons/dist/esm/icons/cube-icon';
import ExclamationCircleIcon from '@patternfly/react-icons/dist/esm/icons/exclamation-circle-icon';
import GlobeIcon from '@patternfly/react-icons/dist/esm/icons/globe-icon';
import HeartbeatIcon from '@patternfly/react-icons/dist/esm/icons/heartbeat-icon';
import KeyIcon from '@patternfly/react-icons/dist/esm/icons/key-icon';
import LayerGroupIcon from '@patternfly/react-icons/dist/esm/icons/layer-group-icon';
import ShieldAltIcon from '@patternfly/react-icons/dist/esm/icons/shield-alt-icon';
import TasksIcon from '@patternfly/react-icons/dist/esm/icons/tasks-icon';
import UsersIcon from '@patternfly/react-icons/dist/esm/icons/users-icon';
import navStyles from '@patternfly/react-styles/css/components/Nav/nav.mjs';
import {
  type ComponentType,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useLocation } from 'react-router';
import { NavList } from 'src/components';
import { type FrameworkPlugin, PLUGIN_MANIFESTS } from './framework/manifest';
import {
  distributionListPath,
  remoteListPath,
  repositoryListPath,
} from './framework/route-patterns';
import { Paths, formatPath } from './paths';
import { usePermissions } from './permissions';
import { usePlugins } from './plugins';
import {
  TaskCountPills,
  taskEntryName,
  useTaskCounts,
} from './shell/task-counts';
import { useUserContext } from './user-context';
import { type AdminScreen, canViewScreen } from './utilities/screen-access';

// One screen the menu leads to, or one expandable section holding screens.
export interface IMenuEntry {
  // Stable name of the entry: the end-to-end hooks hang on it, never on the
  // label.
  id: string;
  label: string;
  // Where a screen entry leads; absent on a section.
  path?: string;
  // Other screens that belong to the entry, so it stays marked as current.
  alternativePaths?: string[];
  icon?: ComponentType;
  // The second level of a section.
  entries?: IMenuEntry[];
}

export interface IMenuGroup {
  id: string;
  // A group without a title is rendered without a label.
  title?: string;
  entries: IMenuEntry[];
}

// A screen the menu leads to as one flat line, for places that list screens:
// the trail in the top bar and the search.
export interface IMenuScreen {
  id: string;
  // Second-level screens read "Repositories - deb".
  label: string;
  path: string;
  alternativePaths: string[];
}

export interface IMenuModel {
  groups: IMenuGroup[];
  screens: IMenuScreen[];
  // The state of the installed plugin list, which the plugin-dependent part
  // of the menu follows.
  plugins: ReturnType<typeof usePlugins>;
}

const altPath = (path: string) =>
  formatPath(path, {}, null, { ignoreMissing: true });

interface IPluginPaths {
  key: string;
  label: string;
  repositories?: string;
  remotes?: string;
  packages?: string;
}

// The lists of packages the plugins have; they are not part of a manifest
// because their screens are not described by a descriptor.
const PACKAGE_LISTS: Partial<Record<FrameworkPlugin, string>> = {
  rpm: Paths.rpm.package.list,
  python: Paths.python.package.list,
};

// The plugins that have screens, in the order the second level lists them: the
// plugins of the manifests, with an entry for each resource a manifest lists,
// then ansible, which has no manifest yet. The label is translated here, where
// it is drawn, because a manifest holds plain strings only.
function pluginPaths(): IPluginPaths[] {
  return [
    ...PLUGIN_MANIFESTS.map(({ plugin, label, resources }) => ({
      key: plugin,
      label: plugin === 'file' ? t`File` : label,
      repositories: resources.includes('repository')
        ? repositoryListPath(plugin)
        : undefined,
      remotes: resources.includes('remote')
        ? remoteListPath(plugin)
        : undefined,
      packages: PACKAGE_LISTS[plugin],
    })),
    {
      key: 'ansible',
      label: 'Ansible',
      repositories: Paths.ansible.repository.list,
      remotes: Paths.ansible.remote.list,
    },
  ];
}

function pluginEntries(
  installed: ReadonlySet<string>,
  kind: 'repositories' | 'remotes' | 'packages',
): IMenuEntry[] {
  return pluginPaths()
    .filter((plugin) => installed.has(plugin.key) && plugin[kind])
    .map((plugin) => ({
      id: `${plugin.key}-${kind}`,
      label: plugin.label,
      path: formatPath(plugin[kind] as string),
    }));
}

// Which entries exist for this session and these installed plugins. What is
// offered here is a matter of presentation: Pulp decides on every request what
// the signed-in user may read or change.
function buildGroups(
  signedIn: boolean,
  installed: ReadonlySet<string>,
  canView: (screen: AdminScreen) => boolean,
): IMenuGroup[] {
  // Before sign-in the menu leads only to the login page. The status screen
  // stays reachable by its address and from the brand link; what it shows to a
  // visitor is the server's decision.
  if (!signedIn) {
    return [
      {
        id: 'sign-in',
        entries: [
          {
            id: 'login',
            label: t`Login`,
            path: formatPath(Paths.meta.login),
          },
        ],
      },
    ];
  }

  const status: IMenuEntry = {
    id: 'status',
    label: t`Workers and status`,
    path: formatPath(Paths.core.status),
    icon: HeartbeatIcon,
  };

  // The one list of every plugin's distributions is offered once at least one
  // plugin that has distributions is installed.
  const distributions: IMenuEntry[] = PLUGIN_MANIFESTS.some(({ plugin }) =>
    installed.has(plugin),
  )
    ? [
        {
          id: 'distributions',
          label: t`Distributions`,
          path: formatPath(distributionListPath()),
          icon: GlobeIcon,
        },
      ]
    : [];

  const sections: IMenuEntry[] = [
    {
      id: 'repositories',
      label: t`Repositories`,
      icon: LayerGroupIcon,
      entries: pluginEntries(installed, 'repositories'),
    },
    ...distributions,
    {
      id: 'packages',
      label: t`Packages and artifacts`,
      icon: CubeIcon,
      entries: pluginEntries(installed, 'packages'),
    },
    {
      id: 'remotes',
      label: t`Remotes`,
      icon: CloudDownloadAltIcon,
      entries: pluginEntries(installed, 'remotes'),
    },
  ].filter((section) => !section.entries || section.entries.length > 0);

  const groups: IMenuGroup[] = [
    { id: 'content', title: t`Content`, entries: sections },
    {
      id: 'operations',
      title: t`Operations`,
      entries: [
        {
          id: 'tasks',
          label: t`Tasks`,
          path: formatPath(Paths.core.task.list),
          alternativePaths: [altPath(Paths.core.task.detail)],
          icon: TasksIcon,
        },
        status,
        ...(canView('signing-services')
          ? [
              {
                id: 'signing-services',
                label: t`Signing services`,
                path: formatPath(Paths.core.signature_keys),
                icon: KeyIcon,
              },
            ]
          : []),
      ],
    },
    {
      id: 'access',
      title: t`Access`,
      entries: [
        {
          id: 'users-and-groups',
          label: t`Users and groups`,
          icon: UsersIcon,
          entries: [
            ...(canView('users')
              ? [
                  {
                    id: 'users',
                    label: t`Users`,
                    path: formatPath(Paths.core.user.list),
                  },
                ]
              : []),
            ...(canView('groups')
              ? [
                  {
                    id: 'groups',
                    label: t`Groups`,
                    path: formatPath(Paths.core.group.list),
                    alternativePaths: [altPath(Paths.core.group.detail)],
                  },
                ]
              : []),
          ],
        },
        ...(canView('roles')
          ? [
              {
                id: 'roles',
                label: t`Roles`,
                path: formatPath(Paths.core.role.list),
                alternativePaths: [altPath(Paths.core.role.edit)],
                icon: ShieldAltIcon,
              },
            ]
          : []),
      ].filter((entry) => !entry.entries || entry.entries.length > 0),
    },
  ];

  return groups.filter((group) => group.entries.length > 0);
}

function flatten(groups: IMenuGroup[]): IMenuScreen[] {
  const screens: IMenuScreen[] = [];
  const visit = (entry: IMenuEntry, parent?: IMenuEntry) => {
    if (entry.path) {
      screens.push({
        id: entry.id,
        label: parent ? `${parent.label} - ${entry.label}` : entry.label,
        path: entry.path,
        alternativePaths: entry.alternativePaths ?? [],
      });
    }
    entry.entries?.forEach((child) => visit(child, entry));
  };
  groups.forEach((group) => group.entries.forEach((entry) => visit(entry)));
  return screens;
}

// The entries the menu shows for the current session, the installed plugins and
// the signed-in user's permissions, as sections and as a flat list of screens.
// While the plugin list is loading or could not be read, nothing that depends
// on a plugin is included; while the permissions are unknown, no
// administration entry is.
export function useMenuModel(): IMenuModel {
  const { user } = useUserContext();
  const plugins = usePlugins();
  const permissions = usePermissions();
  const signedIn = !!user;
  const versions = plugins.state === 'ready' ? plugins.versions : null;

  return useMemo(() => {
    const installed: ReadonlySet<string> = new Set(versions?.keys() ?? []);
    const groups = buildGroups(signedIn, installed, (screen) =>
      canViewScreen(screen, permissions),
    );
    return { groups, screens: flatten(groups), plugins };
  }, [signedIn, versions, plugins, permissions]);
}

// A path without its trailing slash and without trailing parameters, so a
// route pattern and a visited address compare by their fixed beginning.
const normalize = (path: string) =>
  path.replace(/\/$/, '').replace(/(\/:[^/:]+)+$/, '');

const matches = (pathname: string, path: string) => {
  const base = normalize(path);
  const visited = pathname.replace(/\/$/, '');
  return visited === base || visited.startsWith(`${base}/`);
};

// The screen of the list that the visited address belongs to. When several
// paths match (a list and a screen below it), the most specific one wins.
export function currentScreen(
  screens: IMenuScreen[],
  pathname: string,
): IMenuScreen | undefined {
  let best: IMenuScreen | undefined;
  let bestLength = -1;
  for (const entry of screens) {
    for (const path of [entry.path, ...entry.alternativePaths]) {
      const length = normalize(path).length;
      if (matches(pathname, path) && length > bestLength) {
        best = entry;
        bestLength = length;
      }
    }
  }
  return best;
}

function isCurrent(entry: IMenuEntry, pathname: string): boolean {
  if (entry.entries) {
    return entry.entries.some((child) => isCurrent(child, pathname));
  }
  return [entry.path, ...(entry.alternativePaths ?? [])].some(
    (path) => !!path && matches(pathname, path),
  );
}

function EntryLink({
  entry,
  pathname,
}: {
  entry: IMenuEntry;
  pathname: string;
}) {
  return entry.id === 'tasks' ? (
    <TasksEntryLink entry={entry} pathname={pathname} />
  ) : (
    <EntryLinkView entry={entry} pathname={pathname} />
  );
}

// The Tasks entry carries the counts of running and recently failed tasks.
function TasksEntryLink({
  entry,
  pathname,
}: {
  entry: IMenuEntry;
  pathname: string;
}) {
  const counts = useTaskCounts();

  return (
    <EntryLinkView
      entry={entry}
      pathname={pathname}
      name={taskEntryName(entry.label, counts)}
      end={<TaskCountPills {...counts} />}
    />
  );
}

function EntryLinkView({
  entry,
  pathname,
  name,
  end,
}: {
  entry: IMenuEntry;
  pathname: string;
  // Replaces the label as the accessible name of the link.
  name?: string;
  // Shown after the label, at the end of the row.
  end?: ReactNode;
}) {
  const Icon = entry.icon;

  return (
    <NavItem isActive={isCurrent(entry, pathname)}>
      <Link
        to={entry.path as string}
        aria-label={name}
        data-cy={`pulp-menu-item-${entry.id}`}
      >
        {Icon ? (
          <span className={navStyles.navLinkIcon} aria-hidden='true'>
            <Icon />
          </span>
        ) : null}
        <span className={navStyles.navLinkText}>{entry.label}</span>
        {end}
      </Link>
    </NavItem>
  );
}

function Entry({
  entry,
  pathname,
  isExpanded,
}: {
  entry: IMenuEntry;
  pathname: string;
  isExpanded: (id: string, current: boolean) => boolean;
}) {
  if (!entry.entries) {
    return <EntryLink entry={entry} pathname={pathname} />;
  }

  const Icon = entry.icon;
  const current = isCurrent(entry, pathname);

  return (
    <NavExpandable
      title={entry.label}
      icon={Icon ? <Icon aria-hidden='true' /> : undefined}
      groupId={entry.id}
      isActive={current}
      isExpanded={isExpanded(entry.id, current)}
      data-cy={`pulp-menu-section-${entry.id}`}
    >
      {entry.entries.map((child) => (
        <EntryLink key={child.id} entry={child} pathname={pathname} />
      ))}
    </NavExpandable>
  );
}

// The plugin list could not be read: what is missing and a way to ask again,
// in the place where the plugin entries would be. It is a line of the menu, not
// a page, so its only action is a quiet link.
function PluginListError({
  retrying,
  onRetry,
  onGone,
}: {
  retrying: boolean;
  onRetry: () => void;
  // Called as the row leaves the menu, saying whether the focus was inside it.
  onGone: (hadFocus: boolean) => void;
}) {
  const row = useRef<HTMLLIElement>(null);
  const gone = useRef(onGone);
  gone.current = onGone;

  useLayoutEffect(
    () => () => {
      gone.current(!!row.current?.contains(document.activeElement));
    },
    [],
  );

  return (
    <li className='pulp-menu__error' ref={row}>
      <div className='pulp-menu__error-row' role='status'>
        <ExclamationCircleIcon
          className='pulp-menu__error-icon'
          aria-hidden='true'
        />
        <div className='pulp-menu__error-body'>
          <span className='pulp-menu__error-text'>
            {t`The plugin list could not be loaded`}
          </span>
          <Button
            variant='link'
            isInline
            className='pulp-menu__error-retry'
            aria-label={t`Retry loading the plugin list`}
            isLoading={retrying}
            isAriaDisabled={retrying}
            onClick={retrying ? undefined : onRetry}
          >
            {t`Retry`}
          </Button>
        </div>
      </div>
    </li>
  );
}

export const PulpMenu = () => {
  const { groups, plugins } = useMenuModel();
  const { user } = useUserContext();
  const { pathname } = useLocation();
  // What the user opened or closed by hand. A section that was not touched
  // follows the current route: it is open when it holds the current screen.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const isExpanded = (id: string, current: boolean) => toggled[id] ?? current;

  // Set when the plugin list was asked for again by hand with the focus on the
  // row's Retry: once the list arrives and the row is gone, the focus moves to
  // the first entry of the Content group instead of being lost.
  const focusContent = useRef(false);
  const pluginState = plugins.state;
  useEffect(() => {
    if (pluginState === 'ready' && focusContent.current) {
      focusContent.current = false;
      document
        .querySelector<HTMLElement>(
          '[data-cy=pulp-menu-group-content] a[href], [data-cy=pulp-menu-group-content] button',
        )
        ?.focus();
    } else if (pluginState === 'idle') {
      focusContent.current = false;
    }
  }, [pluginState]);

  return (
    <Nav
      aria-label={t`Main`}
      onToggle={(_event, { groupId, isExpanded: open }) =>
        setToggled((previous) => ({ ...previous, [String(groupId)]: open }))
      }
    >
      {user && plugins.state === 'error' ? (
        // The entries that depend on the installed plugins could not be built:
        // the row says so, where those entries would be.
        <NavGroup title={t`Content`}>
          <PluginListError
            retrying={!!plugins.retrying}
            onRetry={plugins.retry}
            onGone={(hadFocus) => {
              focusContent.current = hadFocus;
            }}
          />
        </NavGroup>
      ) : null}
      {groups.map((group) => {
        const entries = group.entries.map((entry) => (
          <Entry
            key={entry.id}
            entry={entry}
            pathname={pathname}
            isExpanded={isExpanded}
          />
        ));

        return group.title ? (
          <NavGroup
            key={group.id}
            title={group.title}
            data-cy={`pulp-menu-group-${group.id}`}
          >
            {entries}
          </NavGroup>
        ) : (
          <NavList key={group.id}>{entries}</NavList>
        );
      })}
    </Nav>
  );
};
