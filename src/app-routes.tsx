import { Trans } from '@lingui/react/macro';
import { Banner, Flex, FlexItem } from '@patternfly/react-core';
import WrenchIcon from '@patternfly/react-icons/dist/esm/icons/wrench-icon';
import { type ElementType } from 'react';
import { Navigate, redirect, useLocation } from 'react-router';
import {
  ErrorBoundary,
  ExternalLink,
  LoadingPage,
  NotFound,
} from 'src/components';
import { PluginNotInstalled } from 'src/components/plugin-not-installed';
import {
  AboutProject,
  AnsibleRemoteDetail,
  AnsibleRemoteEdit,
  AnsibleRemoteList,
  AnsibleRepositoryDetail,
  AnsibleRepositoryEdit,
  AnsibleRepositoryList,
  DebRemoteDetail,
  DebRemoteEdit,
  DebRemoteList,
  DebRepositoryDetail,
  DebRepositoryEdit,
  DebRepositoryList,
  EditRole,
  EditUser,
  FileRemoteDetail,
  FileRemoteEdit,
  FileRemoteList,
  FileRepositoryDetail,
  FileRepositoryEdit,
  FileRepositoryList,
  GroupDetail,
  GroupList,
  LoginPage,
  PulpStatus,
  PythonPackageList,
  PythonRemoteDetail,
  PythonRemoteEdit,
  PythonRemoteList,
  PythonRepositoryDetail,
  PythonRepositoryEdit,
  PythonRepositoryList,
  RPMPackageList,
  RPMRemoteDetail,
  RPMRemoteEdit,
  RPMRemoteList,
  RPMRepositoryDetail,
  RPMRepositoryEdit,
  RPMRepositoryList,
  RoleCreate,
  RoleList,
  SignatureKeysList,
  TaskDetail,
  TaskListView,
  UserCreate,
  UserDetail,
  UserList,
  UserProfile,
} from 'src/containers';
import {
  CollectionsComingSoon,
  ContainersComingSoon,
  NamespacesComingSoon,
  RemoteRegistriesComingSoon,
  SearchComingSoon,
} from 'src/containers/coming-soon-screens';
import { Paths, formatPath } from 'src/paths';
import { usePlugins } from 'src/plugins';
import { config } from 'src/ui-config';
import { loginURL } from 'src/utilities';
import { useUserContext } from './user-context';

interface IRouteConfig {
  beta?: boolean;
  component: ElementType;
  noAuth?: boolean;
  path: string;
  // The component name the server reports for the plugin the route belongs
  // to. Routes without one belong to Pulp core.
  plugin?: string;
}

const routes: IRouteConfig[] = [
  {
    component: ContainersComingSoon,
    path: Paths.container.repository.activities,
    plugin: 'container',
  },
  {
    component: ContainersComingSoon,
    path: Paths.container.repository.access,
    plugin: 'container',
  },
  {
    component: ContainersComingSoon,
    path: Paths.container.repository.manifest,
    plugin: 'container',
  },
  {
    component: ContainersComingSoon,
    path: Paths.container.repository.images,
    plugin: 'container',
  },
  {
    component: ContainersComingSoon,
    path: Paths.container.repository.detail,
    plugin: 'container',
  },
  {
    component: ContainersComingSoon,
    path: Paths.container.repository.list,
    plugin: 'container',
  },
  {
    component: RemoteRegistriesComingSoon,
    path: Paths.container.remote.list,
    plugin: 'container',
  },
  {
    component: TaskListView,
    path: Paths.core.task.list,
  },
  {
    component: GroupList,
    path: Paths.core.group.list,
    beta: true,
  },
  {
    component: GroupDetail,
    path: Paths.core.group.detail,
    beta: true,
  },
  {
    component: TaskDetail,
    path: Paths.core.task.detail,
  },
  {
    component: EditRole,
    path: Paths.core.role.edit,
    beta: true,
  },
  {
    component: RoleCreate,
    path: Paths.core.role.create,
    beta: true,
  },
  {
    component: RoleList,
    path: Paths.core.role.list,
    beta: true,
  },
  {
    component: AnsibleRemoteDetail,
    path: Paths.ansible.remote.detail,
  },
  {
    component: AnsibleRemoteEdit,
    path: Paths.ansible.remote.edit,
  },
  {
    component: AnsibleRemoteList,
    path: Paths.ansible.remote.list,
  },
  {
    component: AnsibleRepositoryDetail,
    path: Paths.ansible.repository.detail,
  },
  {
    component: AnsibleRepositoryEdit,
    path: Paths.ansible.repository.edit,
  },
  {
    component: AnsibleRepositoryList,
    path: Paths.ansible.repository.list,
  },
  {
    component: DebRemoteDetail,
    path: Paths.deb.remote.detail,
  },
  {
    component: DebRemoteEdit,
    path: Paths.deb.remote.edit,
  },
  {
    component: DebRemoteList,
    path: Paths.deb.remote.list,
  },
  {
    component: DebRepositoryDetail,
    path: Paths.deb.repository.detail,
  },
  {
    component: DebRepositoryEdit,
    path: Paths.deb.repository.edit,
  },
  {
    component: DebRepositoryList,
    path: Paths.deb.repository.list,
  },
  {
    component: FileRemoteDetail,
    path: Paths.file.remote.detail,
  },
  {
    component: FileRemoteEdit,
    path: Paths.file.remote.edit,
  },
  {
    component: FileRemoteList,
    path: Paths.file.remote.list,
  },
  {
    component: FileRepositoryDetail,
    path: Paths.file.repository.detail,
  },
  {
    component: FileRepositoryEdit,
    path: Paths.file.repository.edit,
  },
  {
    component: FileRepositoryList,
    path: Paths.file.repository.list,
  },
  {
    component: UserProfile,
    path: Paths.core.user.profile,
    beta: true,
  },
  {
    component: UserCreate,
    path: Paths.core.user.create,
    beta: true,
  },
  {
    component: SignatureKeysList,
    path: Paths.core.signature_keys,
  },
  {
    component: EditUser,
    path: Paths.core.user.edit,
    beta: true,
  },
  {
    component: UserDetail,
    path: Paths.core.user.detail,
    beta: true,
  },
  {
    component: UserList,
    path: Paths.core.user.list,
    beta: true,
  },
  {
    component: NamespacesComingSoon,
    path: Paths.ansible.namespace.list,
  },
  {
    component: LoginPage,
    path: Paths.meta.login,
    noAuth: true,
  },
  {
    component: CollectionsComingSoon,
    path: Paths.ansible.collection.docs_page,
  },
  {
    component: CollectionsComingSoon,
    path: Paths.ansible.collection.docs_index,
  },
  {
    component: CollectionsComingSoon,
    path: Paths.ansible.collection.content_docs,
  },
  {
    component: CollectionsComingSoon,
    path: Paths.ansible.collection.content_list,
  },
  {
    component: CollectionsComingSoon,
    path: Paths.ansible.collection.distributions,
  },
  {
    component: CollectionsComingSoon,
    path: Paths.ansible.collection.dependencies,
  },
  {
    component: CollectionsComingSoon,
    path: Paths.ansible.collection.detail,
  },
  {
    component: CollectionsComingSoon,
    path: Paths.ansible.collection.list,
  },
  {
    component: NamespacesComingSoon,
    path: Paths.ansible.namespace.detail,
  },
  {
    component: PulpStatus,
    path: Paths.core.status,
    noAuth: true,
  },
  {
    component: SearchComingSoon,
    path: Paths.meta.search,
  },
  {
    component: AboutProject,
    path: Paths.meta.about,
    noAuth: true,
  },
  {
    component: PythonPackageList,
    path: Paths.python.package.list,
  },
  {
    component: PythonRemoteDetail,
    path: Paths.python.remote.detail,
  },
  {
    component: PythonRemoteEdit,
    path: Paths.python.remote.edit,
  },
  {
    component: PythonRemoteList,
    path: Paths.python.remote.list,
  },
  {
    component: PythonRepositoryDetail,
    path: Paths.python.repository.detail,
  },
  {
    component: PythonRepositoryEdit,
    path: Paths.python.repository.edit,
  },
  {
    component: PythonRepositoryList,
    path: Paths.python.repository.list,
  },
  {
    component: RPMPackageList,
    path: Paths.rpm.package.list,
    beta: true,
  },
  {
    component: RPMRepositoryList,
    path: Paths.rpm.repository.list,
  },
  {
    component: RPMRepositoryEdit,
    path: Paths.rpm.repository.edit,
  },
  {
    component: RPMRepositoryDetail,
    path: Paths.rpm.repository.detail,
  },
  {
    component: RPMRemoteDetail,
    path: Paths.rpm.remote.detail,
  },
  {
    component: RPMRemoteEdit,
    path: Paths.rpm.remote.edit,
  },
  {
    component: RPMRemoteList,
    path: Paths.rpm.remote.list,
  },
];

const AuthHandler = ({
  beta,
  component: Component,
  noAuth,
  path,
  plugin,
}: IRouteConfig) => {
  const { user, status, endReason } = useUserContext();
  const plugins = usePlugins();
  const { pathname, search } = useLocation();
  // The whole address the user asked for, so signing in lands on it.
  const returnPath = `${pathname}${search}`;

  if (status === 'checking' && !noAuth) {
    // Redirecting before the session check answers would make every reload of
    // a protected page look like a logout.
    return <LoadingPage />;
  }

  if (!user && !noAuth) {
    // NOTE: also update LoginLink when changing this
    if (config.UI_EXTERNAL_LOGIN_URI) {
      window.location.replace(loginURL(returnPath));
      return null;
    }

    return (
      <Navigate
        to={formatPath(
          Paths.meta.login,
          {},
          { next: returnPath, ...(endReason ? { reason: endReason } : {}) },
        )}
      />
    );
  }

  // Which screens are offered is a matter of presentation: Pulp decides who
  // may read or write on every request.
  if (plugin && plugins.state === 'ready' && !plugins.versions.has(plugin)) {
    return <PluginNotInstalled plugin={plugin} />;
  }

  const banner = beta ? (
    <Banner variant='blue'>
      <Flex spaceItems={{ default: 'spaceItemsSm' }}>
        <FlexItem>
          <WrenchIcon />
        </FlexItem>
        <FlexItem>
          <Trans>
            This page is under construction and some features may be broken. You
            can contribute at{' '}
            <ExternalLink href='https://github.com/pulp/pulp-ui'>
              Pulp UI
            </ExternalLink>
            .
          </Trans>
        </FlexItem>
      </Flex>
    </Banner>
  ) : null;

  return (
    <>
      {banner}
      <Component path={path} />
    </>
  );
};

const appRoutes = () =>
  routes.map(({ beta, component, noAuth, path, plugin, ...rest }) => ({
    element: (
      <AuthHandler
        beta={beta}
        component={component}
        noAuth={noAuth}
        path={path}
        plugin={plugin}
      />
    ),
    path: path,
    ...rest,
  }));

const convert = (m) => {
  const {
    default: Component,
    clientLoader: loader,
    clientAction: action,
    ...rest
  } = m;
  return { ...rest, loader, action, Component };
};

export const dataRoutes = [
  {
    id: 'root',
    lazy: () => import('src/routes/root').then((m) => convert(m)),
    children: [
      {
        errorElement: <ErrorBoundary />,
        children: [
          {
            index: true,
            loader: () => redirect(formatPath(Paths.core.status)),
          },
          ...appRoutes(),
          // "No matching route" is not handled by the error boundary.
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
];
