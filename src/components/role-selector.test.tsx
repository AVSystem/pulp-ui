import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Role } from 'src/entities/core/role/model';
import { resetSessionEvents } from 'src/session/session-events';
import { answeredRequests } from 'src/test-utils/answered';
import { listOf, role as roleRow } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import {
  SignInAgain,
  serveSignIn,
  signedIn,
} from 'src/test-utils/sign-in-again';
import { RoleSelector } from './role-selector';

// The role picker of the screens that read through the data hooks. It looks
// and behaves like the legacy picker: roles from the role list with a filter
// and paging, ticked rows that the parent owns, roles the target already holds
// shown ticked and disabled. A failed read ends the spinner and offers to read
// again; the end of a session keeps the spinner and shows nothing.

const API = '/pulp/api/v3';
const ROLES = `${API}/roles/`;

afterEach(() => {
  resetSessionEvents();
});

const pause = (ms = 80) => act(() => new Promise((r) => setTimeout(r, ms)));

const failWith = (status: number) =>
  http.get(`*${ROLES}`, () =>
    HttpResponse.json(
      { detail: 'Not for you.' },
      { status, statusText: status === 403 ? 'Forbidden' : 'Server Error' },
    ),
  );

const named = (name: string) =>
  roleRow({ name, description: `${name} role`, permissions: [] });

const serve = (...names: string[]) => {
  const served = listOf(ROLES, names.map(named));
  server.use(served.handler);
  return served;
};

// The parent owns the selection, as the dialogs that use the picker do.
function Harness({
  initial = [],
  assigned = [],
  onUpdate,
  objectType,
}: {
  initial?: Role[];
  assigned?: { role: string }[];
  onUpdate?: (roles: Role[]) => void;
  objectType?: string;
}) {
  const [selected, setSelected] = useState<Role[]>(initial);
  return (
    <>
      <SignInAgain />
      <RoleSelector
        assignedRoles={assigned}
        selectedRoles={selected}
        onRolesUpdate={(next) => {
          onUpdate?.(next);
          setSelected(next);
        }}
        pulpObjectType={objectType}
      />
    </>
  );
}

const rowOf = (name: string) =>
  screen.getByRole('row', { name: new RegExp(`${name} role`) });

describe('RoleSelector reads', () => {
  it.each([
    [403, /Pulp refused|Not for you\./],
    [500, /Error 500 - Server Error/],
  ])(
    'ends its spinner and shows the failure with Retry when the list answers %i',
    async (status, text) => {
      server.use(failWith(status));
      renderWithProviders(<Harness />);

      expect(
        await screen.findByText('Roles list could not be displayed.'),
      ).toBeInTheDocument();
      expect(screen.getByText(text)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
      expect(screen.queryByRole('progressbar')).toBeNull();
    },
  );

  it('reads the list again when Retry is pressed', async () => {
    server.use(failWith(500));
    const { user } = renderWithProviders(<Harness />);
    await screen.findByText('Roles list could not be displayed.');
    const served = serve('editor');

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('editor role')).toBeInTheDocument();
    expect(screen.queryByText('Roles list could not be displayed.')).toBeNull();
    expect(served.queries).toHaveLength(1);
  });

  it('shows the failure with Retry for the 401 a visitor gets', async () => {
    server.use(failWith(401));
    renderWithProviders(<Harness />);

    expect(
      await screen.findByText('Roles list could not be displayed.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('keeps the spinner and shows nothing when the read ends the session', async () => {
    server.use(failWith(401));
    renderWithProviders(<Harness />, { signedIn: true });
    await pause();

    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(screen.queryByText('Roles list could not be displayed.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('asks for the first page of ten, ordered by name', async () => {
    const served = serve('alpha');
    renderWithProviders(<Harness />);

    await screen.findByText('alpha role');

    expect(Object.fromEntries(served.queries[0])).toEqual({
      offset: '0',
      limit: '10',
      ordering: 'name',
    });
  });

  it('asks only for the roles that fit the kind of object, when one is named', async () => {
    const served = serve('alpha');
    renderWithProviders(<Harness objectType='repositories/ansible/ansible' />);

    await screen.findByText('alpha role');

    expect(served.queries[0].get('for_object_type')).toBe(
      `${API}/repositories/ansible/ansible/`,
    );
  });

  it('sends the name filter to the server and shows what it answers', async () => {
    const served = listOf(ROLES, [named('alpha'), named('beta')], {
      matching: (row, query) =>
        row.name.includes(query.get('name__icontains') ?? ''),
    });
    server.use(served.handler);
    const { user } = renderWithProviders(<Harness />);
    await screen.findByText('beta role');

    await user.type(
      await screen.findByRole('textbox', { name: 'name__icontains' }),
      'alp',
    );
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(screen.queryByText('beta role')).toBeNull());
    expect(screen.getByText('alpha role')).toBeInTheDocument();
    expect(served.queries.at(-1)?.get('name__icontains')).toBe('alp');
  });

  it('shows the empty filter state, not the no-roles state, when nothing matches', async () => {
    server.use(
      listOf(ROLES, [named('alpha')], {
        matching: (_row, query) => !query.get('name__icontains'),
      }).handler,
    );
    const { user } = renderWithProviders(<Harness />);
    await screen.findByText('alpha role');
    await user.type(
      await screen.findByRole('textbox', { name: 'name__icontains' }),
      'zzz',
    );
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('No results found')).toBeInTheDocument();
  });

  it('shows the no-roles state when the server has none to assign', async () => {
    serve();
    renderWithProviders(<Harness />);

    expect(await screen.findByText('No assignable roles.')).toBeInTheDocument();
  });

  it('reads the next page when it is asked for', async () => {
    const names = Array.from(
      { length: 12 },
      (_, i) => `r${String(i).padStart(2, '0')}`,
    );
    const served = serve(...names);
    const { user } = renderWithProviders(<Harness />);
    await screen.findByText('r09 role');

    await user.click(
      screen.getAllByRole('button', { name: 'Go to next page' })[0],
    );

    expect(await screen.findByText('r11 role')).toBeInTheDocument();
    expect(screen.queryByText('r09 role')).toBeNull();
    expect(served.queries.at(-1)?.get('offset')).toBe('10');
  });
});

describe('RoleSelector selection', () => {
  it('hands the parent the roles as they are ticked and unticked', async () => {
    serve('alpha', 'beta');
    const onUpdate = vi.fn();
    const { user } = renderWithProviders(<Harness onUpdate={onUpdate} />);
    await screen.findByText('beta role');

    await user.click(within(rowOf('beta')).getByRole('checkbox'));
    expect(onUpdate).toHaveBeenLastCalledWith([
      expect.objectContaining({ name: 'beta' }),
    ]);
    expect(within(rowOf('beta')).getByRole('checkbox')).toBeChecked();

    await user.click(within(rowOf('beta')).getByRole('checkbox'));
    expect(onUpdate).toHaveBeenLastCalledWith([]);
    expect(within(rowOf('beta')).getByRole('checkbox')).not.toBeChecked();
  });

  it('shows the picked roles as chips and drops one when its chip is closed', async () => {
    serve('alpha', 'beta');
    const { user } = renderWithProviders(<Harness />);
    await screen.findByText('beta role');
    await user.click(within(rowOf('alpha')).getByRole('checkbox'));

    expect(screen.getByText('Selected roles')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /close/i }));

    expect(screen.queryByText('Selected roles')).toBeNull();
    expect(within(rowOf('alpha')).getByRole('checkbox')).not.toBeChecked();
  });

  it('shows a role the target already holds ticked and disabled', async () => {
    serve('alpha', 'beta');
    renderWithProviders(<Harness assigned={[{ role: 'alpha' }]} />);
    await screen.findByText('beta role');

    const box = within(rowOf('alpha')).getByRole('checkbox');
    expect(box).toBeChecked();
    expect(box).toBeDisabled();
    expect(within(rowOf('beta')).getByRole('checkbox')).toBeEnabled();
  });

  it('keeps the picked roles when the page changes', async () => {
    const names = Array.from(
      { length: 12 },
      (_, i) => `r${String(i).padStart(2, '0')}`,
    );
    serve(...names);
    const { user } = renderWithProviders(<Harness />);
    await screen.findByText('r09 role');
    await user.click(within(rowOf('r01')).getByRole('checkbox'));

    await user.click(
      screen.getAllByRole('button', { name: 'Go to next page' })[0],
    );
    await screen.findByText('r11 role');

    expect(screen.getByText('Selected roles')).toBeInTheDocument();
    expect(screen.getAllByText('r01').length).toBeGreaterThan(0);
  });
});

describe('RoleSelector after the session ended', () => {
  const refused = () =>
    http.get(`*${ROLES}`, () =>
      HttpResponse.json({ detail: 'no' }, { status: 401 }),
    );

  const signInAgain = (user: ReturnType<typeof renderWithProviders>['user']) =>
    user.click(
      screen.getByRole('button', { name: 'Sign in again', hidden: true }),
    );

  it('reads the roles again and keeps the ticked ones', async () => {
    serveSignIn();
    serve('alpha', 'beta', 'gamma');
    const { user } = renderWithProviders(
      <Harness initial={[named('alpha') as Role, named('beta') as Role]} />,
      { signedIn: true },
    );
    await screen.findByText('gamma role');
    await signedIn();
    serve('alpha', 'beta', 'gamma', 'delta');

    await signInAgain(user);

    expect(await screen.findByText('delta role')).toBeInTheDocument();
    expect(within(rowOf('alpha')).getByRole('checkbox')).toBeChecked();
    expect(within(rowOf('beta')).getByRole('checkbox')).toBeChecked();
    expect(within(rowOf('gamma')).getByRole('checkbox')).not.toBeChecked();
  });

  it('keeps its rows, with no alert, when the read is refused with 401', async () => {
    serveSignIn();
    serve('alpha', 'beta');
    const { user } = renderWithProviders(
      <Harness initial={[named('beta') as Role]} />,
      { signedIn: true },
    );
    await screen.findByText('beta role');
    await signedIn();
    server.use(refused());

    const answers = answeredRequests(ROLES);
    await signInAgain(user);
    await answers.untilAnswered();

    expect(screen.getByText('beta role')).toBeInTheDocument();
    expect(within(rowOf('beta')).getByRole('checkbox')).toBeChecked();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Error 401/)).toBeNull();
  });

  it('keeps the spinner, with no alert, when the first read is refused, and fills in after signing in', async () => {
    serveSignIn();
    server.use(refused());
    const answers = answeredRequests(ROLES);
    const { user } = renderWithProviders(<Harness />, { signedIn: true });
    await signedIn();
    await answers.untilAnswered();
    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
    serve('alpha');

    await signInAgain(user);

    expect(await screen.findByText('alpha role')).toBeInTheDocument();
  });
});
