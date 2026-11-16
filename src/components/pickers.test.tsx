import { act, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetSessionEvents } from 'src/session/session-events';
import { listOf, page } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { RolePermissions } from './role-permissions';
import { SelectGroup } from './select-group';
import { SelectRoles } from './select-roles';
import { SelectUser } from './select-user';

// A picker or role view whose read fails for any reason other than the end of
// the session must end its spinner, say what failed and offer to read again.
// It must also never leave a rejected promise behind that nobody awaits.

const API = '/pulp/api/v3';

afterEach(() => {
  resetSessionEvents();
});

const pause = (ms = 80) => act(() => new Promise((r) => setTimeout(r, ms)));

const failWith = (path: string, status: number) =>
  http.get(`*${path}`, () =>
    HttpResponse.json(
      { detail: 'Not for you.' },
      { status, statusText: status === 403 ? 'Forbidden' : 'Server Error' },
    ),
  );

interface IPicker {
  name: string;
  path: string;
  title: string;
  rows: object[];
  shown: string;
  element: () => ReactElement;
}

const pickers: IPicker[] = [
  {
    name: 'the user picker',
    path: `${API}/users/`,
    title: 'Users list could not be displayed.',
    rows: [{ username: 'ada' }],
    shown: 'ada',
    element: () => <SelectUser assignedUsers={[]} updateUser={vi.fn()} />,
  },
  {
    name: 'the group picker',
    path: `${API}/groups/`,
    title: 'Groups list could not be displayed.',
    rows: [{ name: 'ops', id: 1 }],
    shown: 'ops',
    element: () => <SelectGroup assignedGroups={[]} updateGroup={vi.fn()} />,
  },
  {
    name: 'the role picker',
    path: `${API}/roles/`,
    title: 'Roles list could not be displayed.',
    rows: [{ name: 'editor', description: 'can edit things' }],
    shown: 'can edit things',
    element: () => (
      <SelectRoles
        assignedRoles={[]}
        selectedRoles={[]}
        onRolesUpdate={vi.fn()}
      />
    ),
  },
];

describe.each(pickers)('$name', ({ path, title, rows, shown, element }) => {
  it.each([
    [403, /Pulp refused|Not for you\./],
    [500, /Error 500 - Server Error/],
  ])(
    'ends its spinner and shows the failure with Retry when the list answers %i',
    async (status, text) => {
      server.use(failWith(path, status));
      renderWithProviders(element());

      expect(await screen.findByText(title)).toBeInTheDocument();
      expect(screen.getByText(text)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
      expect(screen.queryByRole('progressbar')).toBeNull();
    },
  );

  it('reads the list again when Retry is pressed', async () => {
    server.use(failWith(path, 500));
    const { user } = renderWithProviders(element());
    await screen.findByText(title);
    const served = listOf(path, rows);
    server.use(served.handler);

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText(shown)).toBeInTheDocument();
    expect(screen.queryByText(title)).toBeNull();
    expect(served.queries).toHaveLength(1);
  });

  it('keeps the spinner and shows nothing when the read ends the session', async () => {
    server.use(failWith(path, 401));
    renderWithProviders(element());
    await pause();

    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(screen.queryByText(title)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the role permission view', () => {
  const ROLES = `${API}/roles/`;
  const roleNamed = (name: string) => ({
    name,
    description: `${name} description`,
    permissions: [],
  });

  it.each([
    [403, /Pulp refused|Not for you\./],
    [500, /Error 500 - Server Error/],
  ])(
    'ends its spinner and shows the failure with Retry when the role answers %i',
    async (status, text) => {
      server.use(failWith(ROLES, status));
      renderWithProviders(<RolePermissions name='editor' />);

      expect(
        await screen.findByText('Role could not be displayed.'),
      ).toBeInTheDocument();
      expect(screen.getByText(text)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
      expect(screen.queryByRole('progressbar')).toBeNull();
    },
  );

  it('reads the role again when Retry is pressed', async () => {
    server.use(failWith(ROLES, 500));
    const { user } = renderWithProviders(<RolePermissions name='editor' />);
    await screen.findByText('Role could not be displayed.');
    server.use(listOf(ROLES, [roleNamed('editor')]).handler);

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('editor description')).toBeInTheDocument();
    expect(screen.queryByText('Role could not be displayed.')).toBeNull();
  });

  it('keeps the spinner and shows nothing when the read ends the session', async () => {
    server.use(failWith(ROLES, 401));
    renderWithProviders(<RolePermissions name='editor' />);
    await pause();

    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(screen.queryByText('Role could not be displayed.')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says the role could not be displayed when the answer holds no role', async () => {
    server.use(http.get(`*${ROLES}`, () => HttpResponse.json(page([]))));
    renderWithProviders(<RolePermissions name='gone' />);

    expect(
      await screen.findByText('Role could not be displayed.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('reads the new role when the name changes and ignores a late answer for the old name', async () => {
    let releaseOld: () => void = () => undefined;
    const oldAnswer = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    const names: (string | null)[] = [];
    server.use(
      http.get(`*${ROLES}`, async ({ request }) => {
        const name = new URL(request.url).searchParams.get('name');
        names.push(name);
        if (name === 'old') {
          await oldAnswer;
        }
        return HttpResponse.json(page([roleNamed(name)]));
      }),
    );
    const { rerender } = renderWithProviders(<RolePermissions name='old' />);
    await waitFor(() => expect(names).toEqual(['old']));

    rerender(<RolePermissions name='new' />);

    expect(await screen.findByText('new description')).toBeInTheDocument();
    expect(names).toEqual(['old', 'new']);
    await act(async () => {
      releaseOld();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.getByText('new description')).toBeInTheDocument();
    expect(screen.queryByText('old description')).toBeNull();
  });
});
