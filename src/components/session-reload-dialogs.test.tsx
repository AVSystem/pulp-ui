import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { type ReactNode, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { resetSessionEvents } from 'src/session/session-events';
import { listOf, page } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import {
  SignInAgain,
  recordWrites,
  serveSignIn,
  signedIn,
} from 'src/test-utils/sign-in-again';
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

const pause = (ms = 80) => act(() => new Promise((r) => setTimeout(r, ms)));

const signInAgain = (user) =>
  user.click(screen.getByRole('button', { name: 'Sign in again' }));

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
    const { user } = renderWithProviders(<Harness />);
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
    const { user } = renderWithProviders(<Harness initial={[role('beta')]} />);
    await screen.findByText('beta role');
    await signedIn();
    server.use(refused(`${API}/roles/`));

    await signInAgain(user);
    await pause();

    expect(screen.getByText('beta role')).toBeInTheDocument();
    expect(within(rowOf('beta')).getByRole('checkbox')).toBeChecked();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Error 401/)).toBeNull();
  });

  it('keeps the spinner, with no alert, when the first read is refused, and fills in after signing in', async () => {
    serveSignIn();
    server.use(refused(`${API}/roles/`));
    const { user } = renderWithProviders(<Harness />);
    await signedIn();
    await pause();
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
    const { user } = renderWithProviders(<Harness />);
    await screen.findByText('alpha role');
    await signedIn();

    await signInAgain(user);
    await pause();

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
      const { user } = renderWithProviders(<Harness initial={row('beta')} />);
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
      const { user } = renderWithProviders(<Harness />);
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
      const { user } = renderWithProviders(<Harness initial={row('beta')} />);
      await screen.findByText('alpha');
      await signedIn();
      server.use(refused(`${API}/${path}/`));

      await signInAgain(user);
      await pause();

      expect(screen.getByText('alpha')).toBeInTheDocument();
      expect(radioOf('beta')).toBeChecked();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.queryByText(/Error 401/)).toBeNull();
    });

    it('keeps the spinner, with no alert, when the first read is refused, and fills in after signing in', async () => {
      serveSignIn();
      server.use(refused(`${API}/${path}/`));
      const { user } = renderWithProviders(<Harness />);
      await signedIn();
      await pause();
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
      const { user } = renderWithProviders(<Harness />);
      await screen.findByText('alpha');
      await signedIn();

      await signInAgain(user);
      await pause();

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

    await signInAgain(user);
    await pause();

    expect(screen.getByText('first text')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('keeps the spinner when the first read is refused and fills in after signing in', async () => {
    serveSignIn();
    server.use(refused(ROLES));
    const { user } = renderIt();
    await signedIn();
    await pause();
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

    await signInAgain(user);
    await pause();

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
    const { user } = renderWithProviders(<Harness />);
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
    const { user } = renderWithProviders(<Harness />);
    await signedIn();
    await pause();

    await signInAgain(user);
    await pause();

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
    renderWithProviders(<Harness />);

    expect(
      await screen.findByText('Groups list could not be displayed.'),
    ).toBeInTheDocument();
  });

  it('sends no write', async () => {
    serveSignIn();
    const queries = serveGroups('ops');
    const recorded = recordWrites();
    const { user } = renderWithProviders(<Harness />);
    await waitFor(() => expect(queries).toHaveLength(1));
    await signedIn();

    await signInAgain(user);
    await pause();

    expect(recorded.writes).toEqual([`POST ${API}/login/`]);
    recorded.stop();
  });
});
