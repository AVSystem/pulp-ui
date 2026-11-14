import { t } from '@lingui/core/macro';
import { Nav, NavExpandable, NavGroup, NavItem } from '@patternfly/react-core';
import CloudDownloadAltIcon from '@patternfly/react-icons/dist/esm/icons/cloud-download-alt-icon';
import CubeIcon from '@patternfly/react-icons/dist/esm/icons/cube-icon';
import HeartbeatIcon from '@patternfly/react-icons/dist/esm/icons/heartbeat-icon';
import KeyIcon from '@patternfly/react-icons/dist/esm/icons/key-icon';
import LayerGroupIcon from '@patternfly/react-icons/dist/esm/icons/layer-group-icon';
import ShieldAltIcon from '@patternfly/react-icons/dist/esm/icons/shield-alt-icon';
import TasksIcon from '@patternfly/react-icons/dist/esm/icons/tasks-icon';
import UsersIcon from '@patternfly/react-icons/dist/esm/icons/users-icon';
import navStyles from '@patternfly/react-styles/css/components/Nav/nav.mjs';
import { type ComponentType, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { NavList } from 'src/components';
import { ListErrorState } from 'src/components/list-error-state';
import { requestErrorDescription } from 'src/utilities/request-error';
import { Paths, formatPath } from './paths';
import { usePlugins } from './plugins';
import { useUserContext } from './user-context';

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
  repositories: string;
  remotes: string;
  packages?: string;
}

// The plugins that have screens, in the order the second level lists them.
function pluginPaths(): IPluginPaths[] {
  return [
    {
      key: 'file',
      label: t`File`,
      repositories: Paths.file.repository.list,
      remotes: Paths.file.remote.list,
    },
    {
      key: 'deb',
      label: 'deb',
      repositories: Paths.deb.repository.list,
      remotes: Paths.deb.remote.list,
    },
    {
      key: 'rpm',
      label: 'RPM',
      repositories: Paths.rpm.repository.list,
      remotes: Paths.rpm.remote.list,
      packages: Paths.rpm.package.list,
    },
    {
      key: 'python',
      label: 'Python',
      repositories: Paths.python.repository.list,
      remotes: Paths.python.remote.list,
      packages: Paths.python.package.list,
    },
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
): IMenuGroup[] {
  const status: IMenuEntry = {
    id: 'status',
    label: t`Workers and status`,
    path: formatPath(Paths.core.status),
    icon: HeartbeatIcon,
  };

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
      { id: 'operations', title: t`Operations`, entries: [status] },
    ];
  }

  const sections: IMenuEntry[] = [
    {
      id: 'repositories',
      label: t`Repositories`,
      icon: LayerGroupIcon,
      entries: pluginEntries(installed, 'repositories'),
    },
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
  ].filter((section) => section.entries.length > 0);

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
        {
          id: 'signing-services',
          label: t`Signing services`,
          path: formatPath(Paths.core.signature_keys),
          icon: KeyIcon,
        },
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
            {
              id: 'users',
              label: t`Users`,
              path: formatPath(Paths.core.user.list),
            },
            {
              id: 'groups',
              label: t`Groups`,
              path: formatPath(Paths.core.group.list),
              alternativePaths: [altPath(Paths.core.group.detail)],
            },
          ],
        },
        {
          id: 'roles',
          label: t`Roles`,
          path: formatPath(Paths.core.role.list),
          alternativePaths: [altPath(Paths.core.role.edit)],
          icon: ShieldAltIcon,
        },
      ],
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

// The entries the menu shows for the current session and the installed
// plugins, as sections and as a flat list of screens. While the plugin list is
// loading or could not be read, nothing that depends on a plugin is included.
export function useMenuModel(): IMenuModel {
  const { user } = useUserContext();
  const plugins = usePlugins();
  const signedIn = !!user;
  const versions = plugins.state === 'ready' ? plugins.versions : null;

  return useMemo(() => {
    const installed: ReadonlySet<string> = new Set(versions?.keys() ?? []);
    const groups = buildGroups(signedIn, installed);
    return { groups, screens: flatten(groups), plugins };
  }, [signedIn, versions, plugins]);
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
  const Icon = entry.icon;

  return (
    <NavItem isActive={isCurrent(entry, pathname)}>
      <Link to={entry.path as string} data-cy={`pulp-menu-item-${entry.id}`}>
        {Icon ? (
          <span className={navStyles.navLinkIcon} aria-hidden='true'>
            <Icon />
          </span>
        ) : null}
        <span className={navStyles.navLinkText}>{entry.label}</span>
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

export const PulpMenu = () => {
  const { groups, plugins } = useMenuModel();
  const { user } = useUserContext();
  const { pathname } = useLocation();
  // What the user opened or closed by hand. A section that was not touched
  // follows the current route: it is open when it holds the current screen.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const isExpanded = (id: string, current: boolean) => toggled[id] ?? current;

  return (
    <Nav
      aria-label={t`Main`}
      onToggle={(_event, { groupId, isExpanded: open }) =>
        setToggled((previous) => ({ ...previous, [String(groupId)]: open }))
      }
    >
      {user && plugins.state === 'error' ? (
        // The entries that depend on the installed plugins could not be built:
        // the reason and a way to ask again, where those entries would be.
        <NavGroup title={t`Content`}>
          <li className='pulp-menu__error'>
            <ListErrorState
              title={t`Could not read the installed plugins`}
              message={requestErrorDescription(plugins.error)}
              onRetry={plugins.retry}
            />
          </li>
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
          <NavGroup key={group.id} title={group.title}>
            {entries}
          </NavGroup>
        ) : (
          <NavList key={group.id}>{entries}</NavList>
        );
      })}
    </Nav>
  );
};
