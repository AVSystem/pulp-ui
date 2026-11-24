import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Banner, Flex, FlexItem } from '@patternfly/react-core';
import WrenchIcon from '@patternfly/react-icons/dist/esm/icons/wrench-icon';
import { type ElementType, useEffect, useRef, useState } from 'react';
import { Navigate, redirect, useLocation, useParams } from 'react-router';
import {
  BaseHeader,
  ErrorBoundary,
  ExternalLink,
  LoadingPage,
  NotFound,
} from 'src/components';
import { ExternalSignInIncomplete } from 'src/components/external-sign-in-incomplete';
import { InsufficientPermissions } from 'src/components/insufficient-permissions';
import { lazyScreen } from 'src/components/lazy-screen';
import { ListErrorState } from 'src/components/list-error-state';
import { Main } from 'src/components/main';
import { PluginNotInstalled } from 'src/components/plugin-not-installed';
import AboutProject from 'src/containers/about-project';
import {
  CollectionsComingSoon,
  ContainersComingSoon,
  NamespacesComingSoon,
  RemoteRegistriesComingSoon,
  SearchComingSoon,
} from 'src/containers/coming-soon-screens';
import LoginPage from 'src/containers/login/login';
import SignedOut from 'src/containers/signed-out';
import { legacyRedirectRoutes } from 'src/framework/legacy-redirects';
import { PLUGIN_MANIFESTS } from 'src/framework/manifest';
import { frameworkCoreRoutes, frameworkRoutes } from 'src/framework/routes';
import { Paths, formatPath } from 'src/paths';
import { usePermissions } from 'src/permissions';
import { usePlugins } from 'src/plugins';
import Root from 'src/routes/root';
import { config } from 'src/ui-config';
import {
  externalLoginAge,
  rememberExternalLogin,
} from 'src/utilities/external-login-attempt';
import { loginURL } from 'src/utilities/login-url';
import { requestErrorDescription } from 'src/utilities/request-error';
import { type AdminScreen, canViewScreen } from 'src/utilities/screen-access';
import { SIGNED_OUT_REASON, useUserContext } from './user-context';

// Every screen of a plugin section or core group is fetched when it is first
// shown, one chunk per section or group, so the entry holds only the shell, the
// sign-in and gate code and the small static pages. Import each screen from its
// own file: a barrel would put every screen back into the entry.
const AnsibleRemoteDetail = lazyScreen(
  () =>
    import(
      /* webpackChunkName: "ansible" */ 'src/containers/ansible-remote/detail'
    ),
);
const AnsibleRemoteEdit = lazyScreen(
  () =>
    import(
      /* webpackChunkName: "ansible" */ 'src/containers/ansible-remote/edit'
    ),
);
const AnsibleRemoteList = lazyScreen(
  () =>
    import(
      /* webpackChunkName: "ansible" */ 'src/containers/ansible-remote/list'
    ),
);
const AnsibleRepositoryDetail = lazyScreen(
  () =>
    import(
      /* webpackChunkName: "ansible" */ 'src/containers/ansible-repository/detail'
    ),
);
const AnsibleRepositoryEdit = lazyScreen(
  () =>
    import(
      /* webpackChunkName: "ansible" */ 'src/containers/ansible-repository/edit'
    ),
);
const AnsibleRepositoryList = lazyScreen(
  () =>
    import(
      /* webpackChunkName: "ansible" */ 'src/containers/ansible-repository/list'
    ),
);
const GroupDetail = lazyScreen(
  () =>
    import(
      /* webpackChunkName: "groups" */ 'src/containers/group-management/group-detail'
    ),
);
const GroupList = lazyScreen(
  () =>
    import(
      /* webpackChunkName: "groups" */ 'src/containers/group-management/group-list'
    ),
);
const PulpStatus = lazyScreen(
  () => import(/* webpackChunkName: "status" */ 'src/containers/pulp-status'),
);
const RoleCreate = lazyScreen(
  () =>
    import(
      /* webpackChunkName: "roles" */ 'src/containers/role-management/role-create'
    ),
);
const EditRole = lazyScreen(
  () =>
    import(
      /* webpackChunkName: "roles" */ 'src/containers/role-management/role-edit'
    ),
);
const RoleList = lazyScreen(
  () =>
    import(
      /* webpackChunkName: "roles" */ 'src/containers/role-management/role-list'
    ),
);
const UserProfile = lazyScreen(
  () =>
    import(
      /* webpackChunkName: "users" */ 'src/containers/settings/user-profile'
    ),
);
const SignatureKeysList = lazyScreen(
  () =>
    import(
      /* webpackChunkName: "signature-keys" */ 'src/framework/signature-keys/signature-key-list'
    ),
);
const TaskDetail = lazyScreen(
  () =>
    import(
      /* webpackChunkName: "tasks" */ 'src/containers/task-management/task-detail'
    ),
);
const TaskListView = lazyScreen(
  () =>
    import(
      /* webpackChunkName: "tasks" */ 'src/containers/task-management/task-list-view'
    ),
);
const UserCreate = lazyScreen(
  () =>
    import(
      /* webpackChunkName: "users" */ 'src/containers/user-management/user-create'
    ),
);
const UserDetail = lazyScreen(
  () =>
    import(
      /* webpackChunkName: "users" */ 'src/containers/user-management/user-detail'
    ),
);
const EditUser = lazyScreen(
  () =>
    import(
      /* webpackChunkName: "users" */ 'src/containers/user-management/user-edit'
    ),
);
const UserList = lazyScreen(
  () =>
    import(
      /* webpackChunkName: "users" */ 'src/containers/user-management/user-list'
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
  // The administration screen the route belongs to. The route shows the
  // insufficient permissions page to a user who may not view that screen, the
  // same rule that hides its menu entry. Presentation only: Pulp decides every
  // request.
  screenAccess?: AdminScreen;
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
    screenAccess: 'groups',
    beta: true,
  },
  {
    component: GroupDetail,
    path: Paths.core.group.detail,
    screenAccess: 'groups',
    beta: true,
  },
  {
    component: TaskDetail,
    path: Paths.core.task.detail,
  },
  {
    component: EditRole,
    path: Paths.core.role.edit,
    screenAccess: 'roles',
    beta: true,
  },
  {
    component: RoleCreate,
    path: Paths.core.role.create,
    screenAccess: 'roles',
    beta: true,
  },
  {
    component: RoleList,
    path: Paths.core.role.list,
    screenAccess: 'roles',
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
    component: UserProfile,
    path: Paths.core.user.profile,
    beta: true,
  },
  {
    component: UserCreate,
    path: Paths.core.user.create,
    screenAccess: 'users',
    beta: true,
  },
  {
    component: SignatureKeysList,
    path: Paths.core.signature_keys,
    screenAccess: 'signing-services',
  },
  {
    component: EditUser,
    path: Paths.core.user.edit,
    screenAccess: 'users',
    beta: true,
  },
  {
    component: UserDetail,
    path: Paths.core.user.detail,
    screenAccess: 'users',
    beta: true,
  },
  {
    component: UserList,
    path: Paths.core.user.list,
    screenAccess: 'users',
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
    component: SignedOut,
    path: Paths.meta.signedOut,
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
];

// A page that loads without a session less than this long after the browser
// was sent to the external login shows that sign-in did not complete instead of
// sending it there again.
const EXTERNAL_LOGIN_RETRY_WINDOW_MS = 30000;

const AuthHandler = ({
  beta,
  component: Component,
  noAuth,
  path,
  plugin,
  screenAccess,
}: IRouteConfig) => {
  const {
    user,
    status,
    endReason,
    sessionError,
    retrySessionCheck,
    generation,
  } = useUserContext();
  const plugins = usePlugins();
  const permissions = usePermissions();
  const { retryIfFailed } = permissions;
  const { pathname, search } = useLocation();

  // A failed permission read is attempted again whenever the user moves to
  // another screen; a read that did not fail is never repeated here.
  useEffect(() => {
    retryIfFailed();
  }, [pathname, retryIfFailed]);

  // The whole address the user asked for, so signing in lands on it.
  const returnPath = `${pathname}${search}`;

  // Only a session check that answered 401 sends the user to sign in. The
  // browser is sent to the external login at most once per attempt: a page
  // that comes back without a session shortly after stops instead of looping.
  const needsExternalLogin =
    !user &&
    !noAuth &&
    status === 'anonymous' &&
    endReason !== SIGNED_OUT_REASON &&
    Boolean(config.UI_EXTERNAL_LOGIN_URI);
  const [signInIncomplete, setSignInIncomplete] = useState(false);
  const redirected = useRef(false);
  useEffect(() => {
    if (!needsExternalLogin) {
      redirected.current = false;
      return;
    }
    if (redirected.current) {
      return;
    }
    redirected.current = true;

    const age = externalLoginAge(Date.now());
    if (age !== null && age < EXTERNAL_LOGIN_RETRY_WINDOW_MS) {
      setSignInIncomplete(true);
      return;
    }
    const attemptedAt = Date.now();
    rememberExternalLogin(attemptedAt);
    // Without this very time read back, a page that comes back could not tell
    // that it was sent away just before (an older stored time proves nothing),
    // and the browser would loop between the two.
    if (externalLoginAge(attemptedAt) !== 0) {
      setSignInIncomplete(true);
      return;
    }
    // NOTE: also update LoginLink when changing this
    window.location.replace(loginURL(returnPath));
  }, [needsExternalLogin, returnPath]);

  if (status === 'checking' && !noAuth) {
    // Redirecting before the session check answers would make every reload of
    // a protected page look like a logout.
    return <LoadingPage />;
  }

  if (status === 'unknown' && !noAuth) {
    // No answer says nothing about the session: nothing redirects, in either
    // login mode, and the user can ask again.
    return (
      <Main>
        <section className='pulp-section'>
          <ListErrorState
            title={t`The session could not be checked`}
            message={requestErrorDescription(sessionError)}
            onRetry={retrySessionCheck}
          />
        </section>
      </Main>
    );
  }

  if (!user && !noAuth) {
    if (config.UI_EXTERNAL_LOGIN_URI) {
      if (endReason === SIGNED_OUT_REASON) {
        return <Navigate replace to={formatPath(Paths.meta.signedOut)} />;
      }

      return signInIncomplete ? <ExternalSignInIncomplete /> : null;
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

  // An administration screen is shown only to a user who may view it. The
  // permissions are read once the session is known: until they are, the page is
  // loading. A failed read is offered again and never shown as a refusal,
  // because it says nothing about what the user may do; only permissions that
  // were read and lack the one the screen needs give the insufficient
  // permissions page. Nothing is offered on a guess, and the server still
  // decides every request.
  if (screenAccess) {
    if (permissions.state === 'unknown') {
      if (!permissions.failed) {
        return <LoadingPage />;
      }

      return (
        <Main>
          <section className='pulp-section'>
            <ListErrorState
              title={t`Your permissions could not be read`}
              message={requestErrorDescription(permissions.error)}
              onRetry={permissions.retry}
            />
          </section>
        </Main>
      );
    }

    if (!canViewScreen(screenAccess, permissions)) {
      // The screen's own header is not drawn, so the page names itself once,
      // in a header; the page under it does not repeat the title.
      return (
        <>
          <BaseHeader title={t`Insufficient permissions`} />
          <InsufficientPermissions showTitle={false} />
        </>
      );
    }
  }

  // Which screens are offered is a matter of presentation: Pulp decides who
  // may read or write on every request. Only an answer from the server that
  // lacks the plugin means it is not installed; while the answer is pending or
  // failed nothing is known about it.
  if (plugin) {
    // Idle means signed out, which only lasts a moment on a screen that needs
    // a session: the sign-in redirect above takes over.
    // A read the user asked for again by hand is shown as loading too.
    if (
      plugins.state === 'loading' ||
      plugins.state === 'idle' ||
      (plugins.state === 'error' && plugins.retrying)
    ) {
      return <LoadingPage />;
    }

    if (plugins.state === 'error') {
      return (
        <Main>
          <section className='pulp-section'>
            <ListErrorState
              title={t`The plugin list could not be loaded`}
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
    <Banner color='blue'>
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
      {/* The screen is mounted for one signed-in account and goes with it. A
          screen that needs no session stays on show when the user signs out,
          and would otherwise keep what it read with the ended session, with
          an answer still in flight landing in it. The generation grows only
          when the account goes away, so the same account signing in again
          keeps the screen, with what was typed and any open dialog. */}
      <Component key={generation} path={path} />
    </>
  );
};

// Every route passes the same gate: the session, the installed plugin and the
// screen's own permission come before the screen.
export const guardRoutes = (configs: IRouteConfig[]) =>
  configs.map(
    ({ beta, component, noAuth, path, plugin, screenAccess, ...rest }) => ({
      element: (
        <AuthHandler
          beta={beta}
          component={component}
          noAuth={noAuth}
          path={path}
          plugin={plugin}
          screenAccess={screenAccess}
        />
      ),
      path: path,
      ...rest,
    }),
  );

// The routes of the plugins whose screens come from their descriptors are built
// from the manifests and appended here. They are never added to the literal
// above, which the crawler reads as text; it reads their addresses from the
// route patterns instead.
const onFramework = PLUGIN_MANIFESTS.filter(({ onFramework }) => onFramework);

const appRoutes = () =>
  guardRoutes([
    ...routes,
    ...frameworkRoutes(onFramework),
    ...frameworkCoreRoutes(),
  ]);

// Task links published before tasks moved to /tasks/<id> (bookmarks, alerts
// pasted into chats) use /tasks/detail/<id> and must keep working. The user
// is moved to the new address with the history entry replaced, so Back does
// not return to the old one, and the query string is kept. The redirect
// needs no session: the page it leads to asks for one and then returns to the
// new address.
const LegacyTaskDetailRedirect = () => {
  const { task } = useParams();
  const { search } = useLocation();

  return (
    <Navigate
      replace
      to={{ pathname: formatPath(Paths.core.task.detail, { task }), search }}
    />
  );
};

export const dataRoutes = [
  {
    id: 'root',
    Component: Root,
    children: [
      {
        errorElement: <ErrorBoundary />,
        children: [
          {
            index: true,
            loader: () => redirect(formatPath(Paths.core.status)),
          },
          ...appRoutes(),
          {
            path: Paths.core.task.legacyDetail,
            element: <LegacyTaskDetailRedirect />,
          },
          // The addresses the screens of a plugin on the framework had before
          // they were rebuilt move to their new addresses.
          ...legacyRedirectRoutes(onFramework),
          // "No matching route" is not handled by the error boundary.
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
];
