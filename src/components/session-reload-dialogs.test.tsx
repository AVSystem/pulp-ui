import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { type ReactNode, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetSessionEvents } from 'src/session/session-events';
import { answeredRequests, reacted } from 'src/test-utils/answered';
import {
  contentGuard,
  distribution,
  listOf,
  page,
  pythonDistribution,
  remote,
  repository,
  task,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import {
  SignInAgain,
  recordWrites,
  serveSignIn,
  signedIn,
} from 'src/test-utils/sign-in-again';
import { ansibleRepositoryCollectionVersionAddAction } from '../actions/ansible-repository-collection-version-add';
import { ansibleRepositoryCollectionVersionRemoveAction } from '../actions/ansible-repository-collection-version-remove';
import { ansibleRepositoryCopyAction } from '../actions/ansible-repository-copy';
import { ansibleRepositorySyncAction } from '../actions/ansible-repository-sync';
import { ansibleRepositoryVersionRevertAction } from '../actions/ansible-repository-version-revert';
import { pythonDistributionEditAction } from '../actions/python-distribution-edit';
import { DeleteRepositoryModal } from './delete-repository-modal';
import { RolePermissions } from './role-permissions';
import { SelectGroup } from './select-group';
import { SelectRoles } from './select-roles';
import { SelectUser } from './select-user';
import { UserForm } from './user-form';

// What every dialog or form that reads data must do once the session has
// ended: read again when the same user signs in again, keep what the user
// chose or typed, and show no alert and no error text for a read that failed
// only because the session ended.

const API = '/pulp/api/v3';

afterEach(() => {
  resetSessionEvents();
});

const refused = (path: string) =>
  http.get(`*${path}`, () =>
    HttpResponse.json({ detail: 'no' }, { status: 401 }),
  );

// an open modal hides the rest of the page from the accessibility tree
const signInAgain = (user) =>
  user.click(
    screen.getByRole('button', { name: 'Sign in again', hidden: true }),
  );

describe('SelectRoles', () => {
  const role = (name: string) => ({ name, description: `${name} role` });

  // The parent owns the selection, as the dialogs that use the picker do.
  function Harness({ initial = [] }: { initial?: { name: string }[] }) {
    const [selected, setSelected] = useState(initial);
    return (
      <>
        <SignInAgain />
        <SelectRoles
          assignedRoles={[]}
          selectedRoles={selected as never}
          onRolesUpdate={setSelected}
        />
      </>
    );
  }

  const serveRoles = (...names: string[]) =>
    server.use(
      listOf(
        `${API}/roles/`,
        names.map((n) => role(n)),
      ).handler,
    );

  const rowOf = (name: string) =>
    screen.getByRole('row', { name: new RegExp(`${name} role`) });

  it('reads the roles again and keeps the ticked ones', async () => {
    serveSignIn();
    serveRoles('alpha', 'beta', 'gamma');
    const { user } = renderWithProviders(
      <Harness initial={[role('alpha'), role('beta')]} />,
      { signedIn: true },
    );
    await screen.findByText('gamma role');
    await signedIn();
    serveRoles('alpha', 'beta', 'gamma', 'delta');

    await signInAgain(user);

    expect(await screen.findByText('delta role')).toBeInTheDocument();
    expect(within(rowOf('alpha')).getByRole('checkbox')).toBeChecked();
    expect(within(rowOf('beta')).getByRole('checkbox')).toBeChecked();
    expect(within(rowOf('gamma')).getByRole('checkbox')).not.toBeChecked();
  });

  it('keeps a role ticked after the sign-in and the re-read', async () => {
    serveSignIn();
    serveRoles('alpha', 'beta');
    const { user } = renderWithProviders(<Harness />, { signedIn: true });
    await screen.findByText('beta role');
    await signedIn();
    await user.click(within(rowOf('beta')).getByRole('checkbox'));
    serveRoles('alpha', 'beta', 'gamma');

    await signInAgain(user);

    await screen.findByText('gamma role');
    expect(within(rowOf('beta')).getByRole('checkbox')).toBeChecked();
  });

  it('keeps its rows, with no alert, when the read is refused with 401', async () => {
    serveSignIn();
    serveRoles('alpha', 'beta');
    const { user } = renderWithProviders(<Harness initial={[role('beta')]} />, {
      signedIn: true,
    });
    await screen.findByText('beta role');
    await signedIn();
    server.use(refused(`${API}/roles/`));

    const answers = answeredRequests(`${API}/roles/`);
    await signInAgain(user);
    await answers.untilAnswered();

    expect(screen.getByText('beta role')).toBeInTheDocument();
    expect(within(rowOf('beta')).getByRole('checkbox')).toBeChecked();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Error 401/)).toBeNull();
  });

  it('keeps the spinner, with no alert, when the first read is refused, and fills in after signing in', async () => {
    serveSignIn();
    server.use(refused(`${API}/roles/`));
    const answers = answeredRequests(`${API}/roles/`);
    const { user } = renderWithProviders(<Harness />, { signedIn: true });
    await signedIn();
    await answers.untilAnswered();
    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
    serveRoles('alpha');

    await signInAgain(user);

    expect(await screen.findByText('alpha role')).toBeInTheDocument();
  });

  it('sends no write', async () => {
    serveSignIn();
    serveRoles('alpha');
    const recorded = recordWrites();
    const { user } = renderWithProviders(<Harness />, { signedIn: true });
    await screen.findByText('alpha role');
    await signedIn();

    const answers = answeredRequests(`${API}/roles/`);
    await signInAgain(user);
    await answers.untilAnswered();

    expect(recorded.writes).toEqual([`POST ${API}/login/`]);
    recorded.stop();
    await waitFor(() => expect(screen.getByText('alpha role')).toBeVisible());
  });
});

// The group and user pickers share one shape: radio rows, one selection owned
// by the parent, a filter that the picker itself holds.
function pickerTests<T extends { name: string }>({
  label,
  path,
  row,
  picker,
}: {
  label: string;
  path: string;
  row: (name: string) => T;
  picker: (selected: T | undefined, onSelect: (x: T) => void) => ReactNode;
}) {
  function Harness({ initial }: { initial?: T }) {
    const [selected, setSelected] = useState<T | undefined>(initial);
    return (
      <>
        <SignInAgain />
        {picker(selected, setSelected)}
      </>
    );
  }

  const serve = (...names: string[]) =>
    server.use(listOf(`${API}/${path}/`, names.map(row)).handler);

  const radioOf = (name: string) =>
    within(screen.getByRole('row', { name: new RegExp(name) })).getByRole(
      'radio',
    );

  describe(label, () => {
    it('reads again, shows the fresh rows and keeps the selection', async () => {
      serveSignIn();
      serve('alpha', 'beta');
      const { user } = renderWithProviders(<Harness initial={row('beta')} />, {
        signedIn: true,
      });
      await screen.findByText('alpha');
      await signedIn();
      serve('alpha', 'beta', 'gamma');

      await signInAgain(user);

      expect(await screen.findByText('gamma')).toBeInTheDocument();
      expect(radioOf('beta')).toBeChecked();
      expect(radioOf('alpha')).not.toBeChecked();
    });

    it('keeps a choice made before the sign-in', async () => {
      serveSignIn();
      serve('alpha', 'beta');
      const { user } = renderWithProviders(<Harness />, { signedIn: true });
      await screen.findByText('alpha');
      await signedIn();
      await user.click(radioOf('alpha'));
      serve('alpha', 'beta', 'gamma');

      await signInAgain(user);

      await screen.findByText('gamma');
      expect(radioOf('alpha')).toBeChecked();
    });

    it('keeps its rows, with no alert, when the read is refused with 401', async () => {
      serveSignIn();
      serve('alpha', 'beta');
      const { user } = renderWithProviders(<Harness initial={row('beta')} />, {
        signedIn: true,
      });
      await screen.findByText('alpha');
      await signedIn();
      server.use(refused(`${API}/${path}/`));

      const answers = answeredRequests(`${API}/${path}/`);
      await signInAgain(user);
      await answers.untilAnswered();

      expect(screen.getByText('alpha')).toBeInTheDocument();
      expect(radioOf('beta')).toBeChecked();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.queryByText(/Error 401/)).toBeNull();
    });

    it('keeps the spinner, with no alert, when the first read is refused, and fills in after signing in', async () => {
      serveSignIn();
      server.use(refused(`${API}/${path}/`));
      const answers = answeredRequests(`${API}/${path}/`);
      const { user } = renderWithProviders(<Harness />, { signedIn: true });
      await signedIn();
      await answers.untilAnswered();
      expect(screen.getByRole('progressbar')).toBeVisible();
      expect(screen.queryByRole('alert')).toBeNull();
      serve('alpha');

      await signInAgain(user);

      expect(await screen.findByText('alpha')).toBeInTheDocument();
    });

    it('sends no write', async () => {
      serveSignIn();
      serve('alpha');
      const recorded = recordWrites();
      const { user } = renderWithProviders(<Harness />, { signedIn: true });
      await screen.findByText('alpha');
      await signedIn();

      const answers = answeredRequests(`${API}/${path}/`);
      await signInAgain(user);
      await answers.untilAnswered();

      expect(recorded.writes).toEqual([`POST ${API}/login/`]);
      recorded.stop();
    });
  });
}

pickerTests({
  label: 'SelectGroup',
  path: 'groups',
  row: (name) => ({ name }) as never as { name: string },
  picker: (selected, onSelect) => (
    <SelectGroup
      assignedGroups={[]}
      selectedGroup={selected as never}
      updateGroup={onSelect}
    />
  ),
});

pickerTests({
  label: 'SelectUser',
  path: 'users',
  row: (name) => ({ name, username: name }),
  picker: (selected, onSelect) => (
    <SelectUser
      assignedUsers={[]}
      selectedUser={selected as never}
      updateUser={onSelect}
    />
  ),
});

describe('RolePermissions', () => {
  const ROLES = `${API}/roles/`;
  const serve = (description: string) =>
    server.use(
      http.get(`*${ROLES}`, () =>
        HttpResponse.json(
          page([{ name: 'reader', description, permissions: ['a.b'] }]),
        ),
      ),
    );

  const renderIt = () =>
    renderWithProviders(
      <>
        <SignInAgain />
        <RolePermissions name='reader' />
      </>,
      { signedIn: true },
    );

  it('reads the role again and shows the fresh description', async () => {
    serveSignIn();
    serve('first text');
    const { user } = renderIt();
    await screen.findByText('first text');
    await signedIn();
    serve('second text');

    await signInAgain(user);

    expect(await screen.findByText('second text')).toBeInTheDocument();
  });

  it('keeps what it shows, with no spinner, when the read is refused with 401', async () => {
    serveSignIn();
    serve('first text');
    const { user } = renderIt();
    await screen.findByText('first text');
    await signedIn();
    server.use(refused(ROLES));

    const answers = answeredRequests(ROLES);
    await signInAgain(user);
    await answers.untilAnswered();

    expect(screen.getByText('first text')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('keeps the spinner when the first read is refused and fills in after signing in', async () => {
    serveSignIn();
    server.use(refused(ROLES));
    const answers = answeredRequests(ROLES);
    const { user } = renderIt();
    await signedIn();
    await answers.untilAnswered();
    expect(screen.getByRole('progressbar')).toBeVisible();
    serve('fresh text');

    await signInAgain(user);

    expect(await screen.findByText('fresh text')).toBeInTheDocument();
  });

  it('sends no write', async () => {
    serveSignIn();
    serve('first text');
    const recorded = recordWrites();
    const { user } = renderIt();
    await screen.findByText('first text');
    await signedIn();

    const answers = answeredRequests(ROLES);
    await signInAgain(user);
    await answers.untilAnswered();

    expect(recorded.writes).toEqual([`POST ${API}/login/`]);
    recorded.stop();
  });
});

describe('UserForm', () => {
  const GROUPS = `${API}/groups/`;
  const newUser = () => ({
    username: 'zoe',
    first_name: '',
    last_name: '',
    email: '',
    password: '',
    groups: [],
  });

  function Harness() {
    const [user, setUser] = useState(newUser());
    return (
      <>
        <SignInAgain />
        <UserForm
          errorMessages={{}}
          isNewUser
          onCancel={() => null}
          saveUser={() => null}
          updateUser={(u) => setUser(u as never)}
          user={user as never}
        />
      </>
    );
  }

  const serveGroups = (...names: string[]) => {
    const served = listOf(
      GROUPS,
      names.map((name, id) => ({ name, id })),
    );
    server.use(served.handler);
    return served.queries;
  };

  it('reads the groups again and keeps what was typed', async () => {
    serveSignIn();
    const first = serveGroups('ops');
    const { user } = renderWithProviders(<Harness />, { signedIn: true });
    await waitFor(() => expect(first).toHaveLength(1));
    await signedIn();
    await user.type(screen.getByLabelText(/Last name/), 'Miller');
    await user.type(screen.getByLabelText(/Password confirmation/), 'abc');
    const second = serveGroups('ops', 'dev');

    await signInAgain(user);

    await waitFor(() => expect(second).toHaveLength(1));
    expect(screen.getByLabelText(/Last name/)).toHaveValue('Miller');
    expect(screen.getByLabelText(/Password confirmation/)).toHaveValue('abc');
    expect(screen.getByLabelText(/^Username/)).toHaveValue('zoe');
  });

  it('shows no alert when the group read is refused with 401', async () => {
    serveSignIn();
    server.use(refused(GROUPS));
    const firstRead = answeredRequests(GROUPS);
    const { user } = renderWithProviders(<Harness />, { signedIn: true });
    await signedIn();
    await firstRead.untilAnswered();

    const secondRead = answeredRequests(GROUPS);
    await signInAgain(user);
    await secondRead.untilAnswered();

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/could not be displayed/)).toBeNull();
    expect(screen.getByLabelText(/Last name/)).toBeVisible();
  });

  it('still shows its alert when the group read fails for another reason', async () => {
    serveSignIn();
    server.use(
      http.get(`*${GROUPS}`, () =>
        HttpResponse.json({ detail: 'broken' }, { status: 500 }),
      ),
    );
    renderWithProviders(<Harness />, { signedIn: true });

    expect(
      await screen.findByText('Groups list could not be displayed.'),
    ).toBeInTheDocument();
  });

  it('sends no write', async () => {
    serveSignIn();
    const queries = serveGroups('ops');
    const recorded = recordWrites();
    const { user } = renderWithProviders(<Harness />, { signedIn: true });
    await waitFor(() => expect(queries).toHaveLength(1));
    await signedIn();

    const answers = answeredRequests(GROUPS);
    await signInAgain(user);
    await answers.untilAnswered();

    expect(recorded.writes).toEqual([`POST ${API}/login/`]);
    recorded.stop();
  });
});

describe('DeleteRepositoryModal', () => {
  const repo = repository({ name: 'tools' });
  const DISTRIBUTIONS = `${API}/distributions/file/file/`;
  const GUARDS = `${API}/contentguards/`;

  const serve = (...names: string[]) =>
    server.use(
      listOf(
        DISTRIBUTIONS,
        names.map((name) =>
          distribution({ base_path: name, repository: repo.pulp_href }),
        ),
        {
          pageSize: 1000,
          matching: (row, query) =>
            query.has('repository')
              ? row.repository === query.get('repository')
              : true,
        },
      ).handler,
      listOf(`${API}/publications/file/file/`, []).handler,
      listOf(GUARDS, []).handler,
    );

  const renderIt = () =>
    renderWithProviders(
      <>
        <SignInAgain />
        <DeleteRepositoryModal
          closeAction={() => null}
          deleteAction={vi.fn()}
          name={repo.name}
          plugin='file'
          pulpHref={repo.pulp_href}
        />
      </>,
      { signedIn: true },
    );

  it('lists the distributions again and keeps the typed name', async () => {
    serveSignIn();
    serve('alpha');
    const { user } = renderIt();
    await screen.findByText('alpha');
    await signedIn();
    await user.type(
      screen.getByRole('textbox', { name: /Type the repository name/ }),
      'to',
    );
    serve('alpha', 'beta');

    await signInAgain(user);

    expect(await screen.findByText('beta')).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: /Type the repository name/ }),
    ).toHaveValue('to');
  });

  it('keeps the list, with no alert, when the read is refused with 401', async () => {
    serveSignIn();
    serve('alpha');
    const { user } = renderIt();
    await screen.findByText('alpha');
    await signedIn();
    server.use(refused(DISTRIBUTIONS));

    const answers = answeredRequests(DISTRIBUTIONS);
    await signInAgain(user);
    await answers.untilAnswered();

    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.queryByText(/could not be listed/)).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('keeps the spinner, with no error, when the first read is refused, and lists after signing in', async () => {
    serveSignIn();
    server.use(
      refused(DISTRIBUTIONS),
      listOf(`${API}/publications/file/file/`, []).handler,
    );
    const answers = answeredRequests(DISTRIBUTIONS);
    const { user } = renderIt();
    await signedIn();
    await answers.untilAnswered();
    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(screen.queryByText(/could not be listed/)).toBeNull();
    serve('alpha');

    await signInAgain(user);

    expect(await screen.findByText('alpha')).toBeInTheDocument();
  });

  it('waits for the guard names when their read is refused with 401', async () => {
    serveSignIn();
    const guard = contentGuard({ name: 'customers' });
    server.use(
      listOf(
        DISTRIBUTIONS,
        [
          distribution({
            base_path: 'alpha',
            repository: repo.pulp_href,
            content_guard: guard.pulp_href,
          }),
        ],
        { pageSize: 1000 },
      ).handler,
      listOf(`${API}/publications/file/file/`, []).handler,
      refused(GUARDS),
    );
    const answers = answeredRequests(GUARDS);
    const { user } = renderIt();
    await signedIn();
    await answers.untilAnswered();

    expect(screen.queryByText('alpha')).toBeNull();
    expect(screen.getByRole('progressbar')).toBeVisible();
    server.use(listOf(GUARDS, [guard]).handler);

    await signInAgain(user);

    expect(await screen.findByText(/Guard: customers/)).toBeInTheDocument();
  });

  it('sends no write', async () => {
    serveSignIn();
    serve('alpha');
    const recorded = recordWrites();
    const { user } = renderIt();
    await screen.findByText('alpha');
    await signedIn();

    const answers = answeredRequests(DISTRIBUTIONS);
    await signInAgain(user);
    await answers.untilAnswered();

    expect(recorded.writes).toEqual([`POST ${API}/login/`]);
    recorded.stop();
  });
});

describe('the edit dialog of a Python distribution', () => {
  const dist = pythonDistribution({ base_path: 'pypi-local' });
  const REMOTES = `${API}/remotes/python/python/`;

  const serveDistribution = (fields: Record<string, unknown> = {}) =>
    server.use(
      http.get(`*${dist.pulp_href}`, () =>
        HttpResponse.json({ ...dist, ...fields }),
      ),
    );

  const serveRemotes = (...names: string[]) => {
    const served = listOf(
      REMOTES,
      names.map((name) => remote({ name })),
    );
    server.use(served.handler);
    return served.queries;
  };

  function Dialog() {
    const context = {
      addAlert: vi.fn(),
      listQuery: vi.fn(),
      query: vi.fn(),
      reloadPage: vi.fn(),
      setState: vi.fn(),
      state: {
        pythonDistributionEditModal: {
          name: dist.name,
          pulp_href: dist.pulp_href,
        },
      },
    };
    return (
      <>
        <SignInAgain />
        {pythonDistributionEditAction.modal(context)}
      </>
    );
  }

  const uploads = () => screen.getByRole('checkbox', { name: /Allow uploads/ });

  it('reads the distribution again and shows the fresh value when the form is untouched', async () => {
    serveSignIn();
    serveDistribution({ allow_uploads: true });
    serveRemotes();
    const { user } = renderWithProviders(<Dialog />, { signedIn: true });
    await waitFor(() => expect(uploads()).toBeChecked());
    await signedIn();
    serveDistribution({ allow_uploads: false });

    await signInAgain(user);

    await waitFor(() => expect(uploads()).not.toBeChecked());
  });

  it('keeps what the user changed and sends no write', async () => {
    serveSignIn();
    serveDistribution({ allow_uploads: true });
    const queries = serveRemotes('mirror');
    const recorded = recordWrites();
    const { user } = renderWithProviders(<Dialog />, { signedIn: true });
    await waitFor(() => expect(uploads()).toBeChecked());
    await signedIn();
    await user.click(uploads());
    expect(uploads()).not.toBeChecked();
    const before = queries.length;
    serveDistribution({ allow_uploads: true });

    await signInAgain(user);
    await waitFor(() => expect(queries.length).toBeGreaterThan(before));
    await reacted();

    expect(uploads()).not.toBeChecked();
    expect(recorded.writes).toEqual([`POST ${API}/login/`]);
    recorded.stop();
  });

  it('keeps the form, with no error, when the read is refused with 401', async () => {
    serveSignIn();
    serveDistribution({ allow_uploads: true });
    serveRemotes();
    const { user } = renderWithProviders(<Dialog />, { signedIn: true });
    await waitFor(() => expect(uploads()).toBeChecked());
    await signedIn();
    server.use(refused(dist.pulp_href), refused(REMOTES));

    const answers = answeredRequests(dist.pulp_href);
    await signInAgain(user);
    await answers.untilAnswered();

    expect(uploads()).toBeChecked();
    expect(screen.queryByText(/Failed to load/)).toBeNull();
  });

  it('keeps the spinner, with no error, when the first read is refused, and shows the form after signing in', async () => {
    serveSignIn();
    server.use(refused(dist.pulp_href), refused(REMOTES));
    const answers = answeredRequests(REMOTES);
    const { user } = renderWithProviders(<Dialog />, { signedIn: true });
    await signedIn();
    await answers.untilAnswered();
    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(screen.queryByText(/Failed to load/)).toBeNull();
    serveDistribution({ allow_uploads: true });
    serveRemotes();

    await signInAgain(user);

    await waitFor(() => expect(uploads()).toBeChecked());
  });

  it('still shows the failure when the read fails for another reason', async () => {
    serveSignIn();
    server.use(
      http.get(`*${dist.pulp_href}`, () =>
        HttpResponse.json({ detail: 'broken' }, { status: 500 }),
      ),
    );
    serveRemotes();
    renderWithProviders(<Dialog />, { signedIn: true });

    expect(
      await screen.findByText(/Failed to load the distribution/),
    ).toBeInTheDocument();
  });
});

describe('the Copy CLI configuration action', () => {
  const repo = repository({ name: 'tools' });
  const DISTRIBUTIONS = `${API}/distributions/ansible/ansible/`;

  // renders the button the action draws and clicks it
  const run = async (addAlert, signedIn = false) => {
    const reads = answeredRequests(DISTRIBUTIONS);
    const { user } = renderWithProviders(
      <>
        {ansibleRepositoryCopyAction.button(
          { name: repo.name, pulp_href: repo.pulp_href },
          { addAlert, hasPermission: () => true },
        )}
      </>,
      { signedIn },
    );
    await user.click(
      screen.getByRole('button', { name: 'Copy CLI configuration' }),
    );
    await reads.untilAnswered();
  };

  it('says there is no distribution when the read is refused with the 401 a visitor gets', async () => {
    server.use(refused(DISTRIBUTIONS));
    const addAlert = vi.fn();

    await run(addAlert);

    expect(addAlert).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'danger' }),
    );
  });

  it('adds no failure alert when the distribution read is refused with 401 for a signed-in user', async () => {
    server.use(refused(DISTRIBUTIONS));
    const addAlert = vi.fn();

    await run(addAlert, true);

    expect(addAlert).not.toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'danger' }),
    );
  });

  it('still says there is no distribution when the read fails for another reason', async () => {
    server.use(
      http.get(`*${DISTRIBUTIONS}`, () =>
        HttpResponse.json({ detail: 'broken' }, { status: 500 }),
      ),
    );
    const addAlert = vi.fn();

    await run(addAlert);

    expect(addAlert).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'danger' }),
    );
  });
});

describe('a write dialog when the session ends during the write', () => {
  const REPO_HREF = `${API}/repositories/ansible/ansible/00000000-0000-4000-8000-0000000000a1/`;
  const COLLECTIONS = `${API}/content/ansible/collection_versions/`;
  const TASK_HREF = `${API}/tasks/00000000-0000-4000-8000-0000000000aa/`;
  const MODIFY = `${REPO_HREF}modify/`;
  const SYNC = `${REPO_HREF}sync/`;

  // The page around a dialog: it holds the state the page holds, draws the
  // dialog the action asks for and lists the alerts the dialog raises.
  function Host({
    action,
    initial,
  }: {
    action: { modal?: (context) => ReactNode };
    initial: Record<string, unknown>;
  }) {
    const [state, setState] = useState(initial);
    const [alerts, setAlerts] = useState<{ title: ReactNode }[]>([]);

    return (
      <>
        <ul aria-label='alerts'>
          {alerts.map((alert, index) => (
            <li key={index}>{alert.title}</li>
          ))}
        </ul>
        <SignInAgain />
        {action.modal?.({
          addAlert: (alert) => setAlerts((all) => [...all, alert]),
          listQuery: () => undefined,
          query: () => undefined,
          reloadPage: () => undefined,
          setState,
          state,
        })}
      </>
    );
  }

  // The write answers 401 until `accept` is called, then starts a task that
  // is already done. Every body sent is kept.
  function serveWrite(path: string) {
    const bodies: unknown[] = [];
    let accepting = false;
    server.use(
      http.post(`*${path}`, async ({ request }) => {
        bodies.push(await request.json());
        return accepting
          ? HttpResponse.json({ task: TASK_HREF }, { status: 202 })
          : HttpResponse.json({ detail: 'no' }, { status: 401 });
      }),
      http.get(`*${TASK_HREF}`, () =>
        HttpResponse.json(task({ pulp_href: TASK_HREF, state: 'completed' })),
      ),
    );
    return {
      bodies,
      accept: () => {
        accepting = true;
      },
    };
  }

  const alertsShown = () =>
    within(screen.getByRole('list', { name: 'alerts', hidden: true }))
      .queryAllByRole('listitem', { hidden: true })
      .map((item) => item.textContent);

  // Presses the button of the dialog, signs in again and presses it once more.
  // Between the two presses nothing may be sent by itself.
  async function pressAcrossSessionEnd({
    user,
    recorded,
    press,
    accept,
    write,
    whileOpen = () => undefined,
  }: {
    user;
    recorded: ReturnType<typeof recordWrites>;
    press: () => Promise<void>;
    accept: () => void;
    write: string;
    // what the open dialog must still show after each refusal
    whileOpen?: () => void;
  }) {
    await signedIn();
    await press();
    await waitFor(() => expect(recorded.writes).toEqual([`POST ${write}`]));
    await reacted();

    expect(recorded.writes).toEqual([`POST ${write}`]);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(alertsShown()).toEqual([]);
    whileOpen();

    await signInAgain(user);
    await waitFor(() =>
      expect(recorded.writes).toEqual([`POST ${write}`, `POST ${API}/login/`]),
    );
    await reacted();

    expect(recorded.writes).toEqual([`POST ${write}`, `POST ${API}/login/`]);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    whileOpen();

    accept();
    await press();

    await waitFor(() =>
      expect(recorded.writes).toEqual([
        `POST ${write}`,
        `POST ${API}/login/`,
        `POST ${write}`,
      ]),
    );
  }

  const rows = Array.from({ length: 12 }, (_, i) => ({
    pulp_href: `${COLLECTIONS}00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}/`,
    namespace: 'ns',
    name: `col${String(i + 1).padStart(2, '0')}`,
    version: '1.0.0',
    description: 'A test collection',
  }));

  it('keeps the add collection dialog open with the selection from page two, and adds once after signing in again', async () => {
    serveSignIn();
    server.use(listOf(COLLECTIONS, rows).handler);
    const written = serveWrite(MODIFY);
    const recorded = recordWrites();
    const { user } = renderWithProviders(
      <Host
        action={ansibleRepositoryCollectionVersionAddAction}
        initial={{
          repository: { name: 'r1', pulp_href: REPO_HREF },
          addCollectionVersionModal: {
            repositoryHref: REPO_HREF,
            repositoryName: 'r1',
            latestVersionHref: null,
          },
        }}
      />,
      { signedIn: true },
    );
    await screen.findByText('ns.col01 v1.0.0');
    await user.click(
      screen.getAllByRole('button', { name: /go to next page/i })[0],
    );
    await user.click(await screen.findByText('ns.col11 v1.0.0'));
    await user.click(screen.getByText('ns.col12 v1.0.0'));
    const select = () => screen.getByRole('button', { name: 'Select' });

    await pressAcrossSessionEnd({
      user,
      recorded,
      press: () => user.click(select()),
      accept: written.accept,
      write: MODIFY,
      whileOpen: () => {
        expect(
          screen.getByRole('checkbox', { name: 'ns.col11 v1.0.0' }),
        ).toBeChecked();
        expect(
          screen.getByRole('checkbox', { name: 'ns.col12 v1.0.0' }),
        ).toBeChecked();
        expect(screen.queryByText('ns.col01 v1.0.0')).toBeNull();
      },
    });

    expect(written.bodies).toEqual([
      { add_content_units: [rows[10].pulp_href, rows[11].pulp_href] },
      { add_content_units: [rows[10].pulp_href, rows[11].pulp_href] },
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    recorded.stop();
  });

  it('keeps the remove collection dialog open and removes once after signing in again', async () => {
    serveSignIn();
    const written = serveWrite(MODIFY);
    const recorded = recordWrites();
    const { user } = renderWithProviders(
      <Host
        action={ansibleRepositoryCollectionVersionRemoveAction}
        initial={{
          removeCollectionVersionModal: {
            collection: { namespace: 'ns', name: 'col01', version: '1.0.0' },
            repositoryName: 'r1',
            repositoryHref: REPO_HREF,
            collectionVersionHref: rows[0].pulp_href,
          },
        }}
      />,
      { signedIn: true },
    );
    const remove = () => screen.getByRole('button', { name: /^Remove/ });

    await pressAcrossSessionEnd({
      user,
      recorded,
      press: () => user.click(remove()),
      accept: written.accept,
      write: MODIFY,
    });

    expect(written.bodies).toEqual([
      { remove_content_units: [rows[0].pulp_href] },
      { remove_content_units: [rows[0].pulp_href] },
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    recorded.stop();
  });

  it('keeps the sync dialog open with the changed options and syncs once after signing in again', async () => {
    serveSignIn();
    const written = serveWrite(SYNC);
    const recorded = recordWrites();
    const { user } = renderWithProviders(
      <Host
        action={ansibleRepositorySyncAction}
        initial={{ syncModalOpen: { name: 'r1', pulp_href: REPO_HREF } }}
      />,
      { signedIn: true },
    );
    const sync = () => screen.getByRole('button', { name: /^Sync/ });
    const mirror = () =>
      screen.getByRole('switch', { name: /Content not present in remote/ });
    await user.click(mirror());
    expect(mirror()).not.toBeChecked();

    await pressAcrossSessionEnd({
      user,
      recorded,
      press: () => user.click(sync()),
      accept: written.accept,
      write: SYNC,
      whileOpen: () => expect(mirror()).not.toBeChecked(),
    });

    expect(written.bodies).toEqual([
      expect.objectContaining({ mirror: false }),
      expect.objectContaining({ mirror: false }),
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    recorded.stop();
  });

  it('keeps the revert dialog open and reverts once after signing in again', async () => {
    serveSignIn();
    const written = serveWrite(MODIFY);
    const recorded = recordWrites();
    const version = `${REPO_HREF}versions/2/`;
    const { user } = renderWithProviders(
      <Host
        action={ansibleRepositoryVersionRevertAction}
        initial={{
          revertModal: {
            repositoryName: 'r1',
            number: 2,
            pulp_href: version,
          },
        }}
      />,
      { signedIn: true },
    );
    const revert = () => screen.getByRole('button', { name: /^Revert/ });

    await pressAcrossSessionEnd({
      user,
      recorded,
      press: () => user.click(revert()),
      accept: written.accept,
      write: MODIFY,
    });

    expect(written.bodies).toEqual([
      { base_version: version },
      { base_version: version },
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    recorded.stop();
  });

  it('still closes the dialog and shows an alert when the write fails for another reason', async () => {
    serveSignIn();
    server.use(
      http.post(`*${MODIFY}`, () =>
        HttpResponse.json({ detail: 'broken' }, { status: 500 }),
      ),
    );
    const { user } = renderWithProviders(
      <Host
        action={ansibleRepositoryCollectionVersionRemoveAction}
        initial={{
          removeCollectionVersionModal: {
            collection: { namespace: 'ns', name: 'col01', version: '1.0.0' },
            repositoryName: 'r1',
            repositoryHref: REPO_HREF,
            collectionVersionHref: rows[0].pulp_href,
          },
        }}
      />,
      { signedIn: true },
    );
    await signedIn();

    await user.click(screen.getByRole('button', { name: /^Remove/ }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(alertsShown()).toEqual([
      'Failed to remove ns.col01 v1.0.0 from repository "r1".',
    ]);
  });
});
