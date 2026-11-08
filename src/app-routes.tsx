import { t } from '@lingui/core/macro';
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
import { lazyScreen } from 'src/components/lazy-screen';
import { ListErrorState } from 'src/components/list-error-state';
import { Main } from 'src/components/main';
import { PluginNotInstalled } from 'src/components/plugin-not-installed';
import AboutProject from 'src/containers/about-project';
import AnsibleRemoteDetail from 'src/containers/ansible-remote/detail';
import AnsibleRemoteEdit from 'src/containers/ansible-remote/edit';
import AnsibleRemoteList from 'src/containers/ansible-remote/list';
import AnsibleRepositoryDetail from 'src/containers/ansible-repository/detail';
import AnsibleRepositoryEdit from 'src/containers/ansible-repository/edit';
import AnsibleRepositoryList from 'src/containers/ansible-repository/list';
import {
  CollectionsComingSoon,
  ContainersComingSoon,
  NamespacesComingSoon,
  RemoteRegistriesComingSoon,
  SearchComingSoon,
} from 'src/containers/coming-soon-screens';
import DebRemoteDetail from 'src/containers/deb-remote/detail';
import DebRemoteEdit from 'src/containers/deb-remote/edit';
import DebRemoteList from 'src/containers/deb-remote/list';
import DebRepositoryDetail from 'src/containers/deb-repository/detail';
import DebRepositoryEdit from 'src/containers/deb-repository/edit';
import DebRepositoryList from 'src/containers/deb-repository/list';
import GroupDetail from 'src/containers/group-management/group-detail';
import GroupList from 'src/containers/group-management/group-list';
import LoginPage from 'src/containers/login/login';
import PulpStatus from 'src/containers/pulp-status';
import PythonRemoteDetail from 'src/containers/python-remote/detail';
import PythonRemoteEdit from 'src/containers/python-remote/edit';
import PythonRemoteList from 'src/containers/python-remote/list';
import PythonRepositoryDetail from 'src/containers/python-repository/detail';
import PythonRepositoryEdit from 'src/containers/python-repository/edit';
import PythonRepositoryList from 'src/containers/python-repository/list';
import PythonPackageList from 'src/containers/python/package-list';
import RoleCreate from 'src/containers/role-management/role-create';
import EditRole from 'src/containers/role-management/role-edit';
import RoleList from 'src/containers/role-management/role-list';
import RPMRemoteDetail from 'src/containers/rpm-remote/detail';
import RPMRemoteEdit from 'src/containers/rpm-remote/edit';
import RPMRemoteList from 'src/containers/rpm-remote/list';
import RPMRepositoryDetail from 'src/containers/rpm-repository/detail';
import RPMRepositoryEdit from 'src/containers/rpm-repository/edit';
import RPMRepositoryList from 'src/containers/rpm-repository/list';
import RPMPackageList from 'src/containers/rpm/package-list';
import UserProfile from 'src/containers/settings/user-profile';
import SignatureKeysList from 'src/containers/signature-keys/list';
import TaskDetail from 'src/containers/task-management/task-detail';
import TaskListView from 'src/containers/task-management/task-list-view';
import UserCreate from 'src/containers/user-management/user-create';
import UserDetail from 'src/containers/user-management/user-detail';
import EditUser from 'src/containers/user-management/user-edit';
import UserList from 'src/containers/user-management/user-list';
import { Paths, formatPath } from 'src/paths';
import { usePlugins } from 'src/plugins';
import { config } from 'src/ui-config';
import { loginURL } from 'src/utilities';
import { requestErrorDescription } from 'src/utilities/request-error';
import { useUserContext } from './user-context';

// Screens that are fetched when they are first shown, one chunk per section.
// Import each screen from its own file: a barrel would put every screen back
// into the entry.
const FileRemoteDetail = lazyScreen(
  () =>
    import(/* webpackChunkName: "file" */ 'src/containers/file-remote/detail'),
);
const FileRemoteEdit = lazyScreen(
  () =>
    import(/* webpackChunkName: "file" */ 'src/containers/file-remote/edit'),
);
const FileRemoteList = lazyScreen(
  () =>
    import(/* webpackChunkName: "file" */ 'src/containers/file-remote/list'),
);
const FileRepositoryDetail = lazyScreen(
  () =>
    import(
      /* webpackChunkName: "file" */ 'src/containers/file-repository/detail'
    ),
);
const FileRepositoryEdit = lazyScreen(
  () =>
    import(
      /* webpackChunkName: "file" */ 'src/containers/file-repository/edit'
    ),
);
const FileRepositoryList = lazyScreen(
  () =>
    import(
      /* webpackChunkName: "file" */ 'src/containers/file-repository/list'
    ),
);

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
    plugin: 'ansible',
  },
  {
    component: AnsibleRemoteEdit,
    path: Paths.ansible.remote.edit,
    plugin: 'ansible',
  },
  {
    component: AnsibleRemoteList,
    path: Paths.ansible.remote.list,
    plugin: 'ansible',
  },
  {
    component: AnsibleRepositoryDetail,
    path: Paths.ansible.repository.detail,
    plugin: 'ansible',
  },
  {
    component: AnsibleRepositoryEdit,
    path: Paths.ansible.repository.edit,
    plugin: 'ansible',
  },
  {
    component: AnsibleRepositoryList,
    path: Paths.ansible.repository.list,
    plugin: 'ansible',
  },
  {
    component: DebRemoteDetail,
    path: Paths.deb.remote.detail,
    plugin: 'deb',
  },
  {
    component: DebRemoteEdit,
    path: Paths.deb.remote.edit,
    plugin: 'deb',
  },
  {
    component: DebRemoteList,
    path: Paths.deb.remote.list,
    plugin: 'deb',
  },
  {
    component: DebRepositoryDetail,
    path: Paths.deb.repository.detail,
    plugin: 'deb',
  },
  {
    component: DebRepositoryEdit,
    path: Paths.deb.repository.edit,
    plugin: 'deb',
  },
  {
    component: DebRepositoryList,
    path: Paths.deb.repository.list,
    plugin: 'deb',
  },
  {
    component: FileRemoteDetail,
    path: Paths.file.remote.detail,
    plugin: 'file',
  },
  {
    component: FileRemoteEdit,
    path: Paths.file.remote.edit,
    plugin: 'file',
  },
  {
    component: FileRemoteList,
    path: Paths.file.remote.list,
    plugin: 'file',
  },
  {
    component: FileRepositoryDetail,
    path: Paths.file.repository.detail,
    plugin: 'file',
  },
  {
    component: FileRepositoryEdit,
    path: Paths.file.repository.edit,
    plugin: 'file',
  },
  {
    component: FileRepositoryList,
    path: Paths.file.repository.list,
    plugin: 'file',
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
    plugin: 'ansible',
  },
  {
    component: LoginPage,
    path: Paths.meta.login,
    noAuth: true,
  },
  {
    component: CollectionsComingSoon,
    path: Paths.ansible.collection.docs_page,
    plugin: 'ansible',
  },
  {
    component: CollectionsComingSoon,
    path: Paths.ansible.collection.docs_index,
    plugin: 'ansible',
  },
  {
    component: CollectionsComingSoon,
    path: Paths.ansible.collection.content_docs,
    plugin: 'ansible',
  },
  {
    component: CollectionsComingSoon,
    path: Paths.ansible.collection.content_list,
    plugin: 'ansible',
  },
  {
    component: CollectionsComingSoon,
    path: Paths.ansible.collection.distributions,
    plugin: 'ansible',
  },
  {
    component: CollectionsComingSoon,
    path: Paths.ansible.collection.dependencies,
    plugin: 'ansible',
  },
  {
    component: CollectionsComingSoon,
    path: Paths.ansible.collection.detail,
    plugin: 'ansible',
  },
  {
    component: CollectionsComingSoon,
    path: Paths.ansible.collection.list,
    plugin: 'ansible',
  },
  {
    component: NamespacesComingSoon,
    path: Paths.ansible.namespace.detail,
    plugin: 'ansible',
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
    plugin: 'python',
  },
  {
    component: PythonRemoteDetail,
    path: Paths.python.remote.detail,
    plugin: 'python',
  },
  {
    component: PythonRemoteEdit,
    path: Paths.python.remote.edit,
    plugin: 'python',
  },
  {
    component: PythonRemoteList,
    path: Paths.python.remote.list,
    plugin: 'python',
  },
  {
    component: PythonRepositoryDetail,
    path: Paths.python.repository.detail,
    plugin: 'python',
  },
  {
    component: PythonRepositoryEdit,
    path: Paths.python.repository.edit,
    plugin: 'python',
  },
  {
    component: PythonRepositoryList,
    path: Paths.python.repository.list,
    plugin: 'python',
  },
  {
    component: RPMPackageList,
    path: Paths.rpm.package.list,
    plugin: 'rpm',
    beta: true,
  },
  {
    component: RPMRepositoryList,
    path: Paths.rpm.repository.list,
    plugin: 'rpm',
  },
  {
    component: RPMRepositoryEdit,
    path: Paths.rpm.repository.edit,
    plugin: 'rpm',
  },
  {
    component: RPMRepositoryDetail,
    path: Paths.rpm.repository.detail,
    plugin: 'rpm',
  },
  {
    component: RPMRemoteDetail,
    path: Paths.rpm.remote.detail,
    plugin: 'rpm',
  },
  {
    component: RPMRemoteEdit,
    path: Paths.rpm.remote.edit,
    plugin: 'rpm',
  },
  {
    component: RPMRemoteList,
    path: Paths.rpm.remote.list,
    plugin: 'rpm',
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
  // may read or write on every request. Only an answer from the server that
  // lacks the plugin means it is not installed; while the answer is pending or
  // failed nothing is known about it.
  if (plugin) {
    if (plugins.state === 'loading') {
      return <LoadingPage />;
    }

    if (plugins.state === 'error') {
      return (
        <Main>
          <section className='pulp-section'>
            <ListErrorState
              title={t`Could not read the installed plugins`}
              message={requestErrorDescription(plugins.error)}
              onRetry={plugins.retry}
            />
          </section>
        </Main>
      );
    }

    if (!plugins.versions.has(plugin)) {
      return <PluginNotInstalled plugin={plugin} />;
    }
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
