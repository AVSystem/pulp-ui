import { act, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { type ComponentType, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetSessionEvents } from 'src/session/session-events';
import { group, page, user } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import {
  SignInAgain,
  recordWrites,
  serveSignIn,
  signedIn,
} from 'src/test-utils/sign-in-again';
import { ACTION_PERMISSIONS } from '../utilities/action-permissions';
import { RemoteAccessTab } from './ansible-remote/tab-access';
import { RepositoryAccessTab } from './ansible-repository/tab-access';

// Changing who holds which role on a repository or remote is offered only to
// users who may manage the roles of that object. The server decides every
// request; the controls are presentation.

const API = '/pulp/api/v3';
const ID = '00000000-0000-4000-8000-0000000000a1';

afterEach(() => {
  resetSessionEvents();
});

const pause = (ms = 80) => act(() => new Promise((r) => setTimeout(r, ms)));

const answer = (path: string, status: number) =>
  http.get(`*${path}`, () => HttpResponse.json({ detail: 'No.' }, { status }));

const TABS = [
  {
    label: 'ansible repository',
    Tab: RepositoryAccessTab as ComponentType<{ item; actionContext }>,
    base: 'repositories/ansible/ansible',
    manageRoles: ACTION_PERMISSIONS.ansible.repository.manageRoles,
    lookalike: ACTION_PERMISSIONS.ansible.repository.change,
  },
  {
    label: 'ansible remote',
    Tab: RemoteAccessTab as ComponentType<{ item; actionContext }>,
    base: 'remotes/ansible/collection',
    manageRoles: ACTION_PERMISSIONS.ansible.remote.manageRoles,
    lookalike: ACTION_PERMISSIONS.ansible.remote.change,
  },
];

describe.each(TABS)(
  'the access tab of an $label',
  ({ Tab, base, manageRoles, lookalike }) => {
    const item = { pulp_href: `${API}/${base}/${ID}/`, name: 'tools' };

    const ROLES = `${API}/${base}/${ID}/list_roles/`;
    const assigned = () =>
      http.get(`*${ROLES}`, () =>
        HttpResponse.json({
          roles: [{ role: 'viewer', users: ['ann'], groups: ['staff'] }],
        }),
      );

    function renderTab(held: string[], params: Record<string, string> = {}) {
      serveSignIn();
      server.use(assigned());
      const hasObjectPermission = vi.fn((name: string) => held.includes(name));
      const addAlert = vi.fn();
      const view = renderWithProviders(
        <>
          <SignInAgain />
          <Tab
            item={item}
            actionContext={{
              addAlert,
              hasObjectPermission,
              hasPermission: () => false,
              state: { params },
              user: null,
            }}
          />
        </>,
      );
      return { hasObjectPermission, addAlert, ...view };
    }

    const selectUser = () =>
      screen.queryByRole('button', { name: /^Select a user/ });
    const selectGroup = () =>
      screen.queryByRole('button', { name: /^Select a group/ });

    it('offers no role change to a user who may not manage the roles', async () => {
      renderTab([]);

      await screen.findByText('ann');

      expect(selectUser()).toBeNull();
      expect(selectGroup()).toBeNull();
      expect(screen.queryByRole('button', { name: 'Actions' })).toBeNull();
    });

    it('does not take the permission to change the object for it', async () => {
      renderTab([lookalike]);

      await screen.findByText('ann');

      expect(selectUser()).toBeNull();
      expect(selectGroup()).toBeNull();
    });

    it('offers role changes to a user who may manage the roles', async () => {
      const { hasObjectPermission } = renderTab([manageRoles]);

      await screen.findByText('ann');

      expect(selectUser()).toBeInTheDocument();
      expect(selectGroup()).toBeInTheDocument();
      expect(
        screen.getAllByRole('button', { name: 'Actions' }).length,
      ).toBeGreaterThan(0);
      expect(hasObjectPermission).toHaveBeenCalledWith(manageRoles, item);
    });

    describe('selecting a user or a group from the address', () => {
      it('shows the user named in the address from the answer of the user list', async () => {
        const { addAlert } = renderTab([manageRoles], { user: 'ann' });
        server.use(
          http.get(`*${API}/users/`, () =>
            HttpResponse.json(page([user({ username: 'ann' })])),
          ),
        );

        expect(
          await screen.findByRole('heading', { name: 'User ann' }),
        ).toBeInTheDocument();
        expect(addAlert).not.toHaveBeenCalled();
      });

      it('shows the group named in the address from the answer of the group list', async () => {
        const { addAlert } = renderTab([manageRoles], { group: 'staff' });
        server.use(
          http.get(`*${API}/groups/`, () =>
            HttpResponse.json(page([group({ name: 'staff' })])),
          ),
        );

        expect(
          await screen.findByRole('heading', { name: 'Group staff' }),
        ).toBeInTheDocument();
        expect(addAlert).not.toHaveBeenCalled();
      });

      it('selects nothing, with no alert and no unhandled rejection, for a name Pulp does not know', async () => {
        const unhandled = vi.fn();
        process.on('unhandledRejection', unhandled);
        let asked = false;
        try {
          server.use(
            http.get(`*${API}/users/`, () => {
              asked = true;
              return HttpResponse.json(page([]));
            }),
          );
          const { addAlert } = renderTab([manageRoles], { user: 'nobody' });
          await waitFor(() => expect(asked).toBe(true));
          await pause();

          expect(await screen.findByText('ann')).toBeInTheDocument();
          expect(
            screen.queryByRole('heading', { name: /^User / }),
          ).not.toBeInTheDocument();
          expect(addAlert).not.toHaveBeenCalled();
        } finally {
          process.off('unhandledRejection', unhandled);
        }

        expect(unhandled).not.toHaveBeenCalled();
      });

      it('shows one alert with the request error when the user lookup fails', async () => {
        const unhandled = vi.fn();
        process.on('unhandledRejection', unhandled);
        try {
          server.use(answer(`${API}/users/`, 500));
          const { addAlert } = renderTab([manageRoles], { user: 'ann' });

          await waitFor(() => expect(addAlert).toHaveBeenCalledTimes(1));
          await pause();

          expect(addAlert).toHaveBeenCalledTimes(1);
          const [alert] = addAlert.mock.calls[0];
          expect(alert.variant).toBe('danger');
          expect(alert.title).toBe('Users list could not be displayed.');
          expect(alert.description).toBeTruthy();
          expect(
            screen.queryByRole('heading', { name: /^User / }),
          ).not.toBeInTheDocument();
        } finally {
          process.off('unhandledRejection', unhandled);
        }

        expect(unhandled).not.toHaveBeenCalled();
      });

      it('shows one alert with the request error when the group lookup fails', async () => {
        server.use(answer(`${API}/groups/`, 500));
        const { addAlert } = renderTab([manageRoles], { group: 'staff' });

        await waitFor(() => expect(addAlert).toHaveBeenCalledTimes(1));
        await pause();

        expect(addAlert).toHaveBeenCalledTimes(1);
        const [alert] = addAlert.mock.calls[0];
        expect(alert.variant).toBe('danger');
        expect(alert.title).toBe('Groups list could not be displayed.');
        expect(alert.description).toBeTruthy();
      });
    });

    describe('a role change when the session ended', () => {
      it('shows no alert and keeps the confirmation open when the removal is refused with 401', async () => {
        const { user: person, addAlert } = renderTab([manageRoles]);
        server.use(
          http.post(`*${API}/${base}/${ID}/remove_role/`, () =>
            HttpResponse.json({ detail: 'No.' }, { status: 401 }),
          ),
        );
        await screen.findByText('ann');
        await person.click(
          screen.getAllByRole('button', { name: 'Actions' })[0],
        );
        await person.click(
          await screen.findByRole('menuitem', { name: 'Remove user' }),
        );
        await person.click(
          await screen.findByRole('button', { name: 'Delete' }),
        );
        await pause();

        expect(addAlert).not.toHaveBeenCalled();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(
          screen.getByRole('button', { name: 'Delete' }),
        ).toBeInTheDocument();
      });

      it('closes the confirmation and shows one alert when the removal fails for another reason', async () => {
        const { user: person, addAlert } = renderTab([manageRoles]);
        server.use(
          http.post(`*${API}/${base}/${ID}/remove_role/`, () =>
            HttpResponse.json({ detail: 'No.' }, { status: 500 }),
          ),
        );
        await screen.findByText('ann');
        await person.click(
          screen.getAllByRole('button', { name: 'Actions' })[0],
        );
        await person.click(
          await screen.findByRole('menuitem', { name: 'Remove user' }),
        );
        await person.click(
          await screen.findByRole('button', { name: 'Delete' }),
        );

        await waitFor(() => expect(addAlert).toHaveBeenCalledTimes(1));
        await waitFor(() =>
          expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
        );
        expect(addAlert.mock.calls[0][0].variant).toBe('danger');
      });
    });

    describe('reading the roles', () => {
      it('shows an error state with Retry, not the empty owners view, when the read fails', async () => {
        const { user: person } = renderTab([manageRoles]);
        let reads = 0;
        server.use(
          http.get(`*${ROLES}`, () => {
            reads += 1;
            return HttpResponse.json({ detail: 'No.' }, { status: 500 });
          }),
        );

        expect(
          await screen.findByText('Roles list could not be displayed.'),
        ).toBeInTheDocument();
        expect(
          screen.queryByText('There are currently no owners assigned.'),
        ).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Select a/ })).toBeNull();
        const failedReads = reads;
        expect(failedReads).toBeGreaterThan(0);

        server.use(assigned());
        await person.click(screen.getByRole('button', { name: 'Retry' }));

        expect(await screen.findByText('ann')).toBeInTheDocument();
        expect(
          screen.queryByText('Roles list could not be displayed.'),
        ).not.toBeInTheDocument();
        expect(reads).toBe(failedReads);
      });

      it('reads the roles once when the tab is opened after the session epoch has grown', async () => {
        serveSignIn();
        let reads = 0;
        server.use(
          http.get(`*${ROLES}`, () => {
            reads += 1;
            return HttpResponse.json({
              roles: [{ role: 'viewer', users: ['ann'], groups: [] }],
            });
          }),
        );
        const Harness = () => {
          const [shown, setShown] = useState(false);
          return (
            <>
              <SignInAgain />
              <button type='button' onClick={() => setShown(true)}>
                Open the tab
              </button>
              {shown ? (
                <Tab
                  item={item}
                  actionContext={{
                    addAlert: vi.fn(),
                    hasObjectPermission: () => true,
                    hasPermission: () => false,
                    state: { params: {} },
                    user: null,
                  }}
                />
              ) : null}
            </>
          );
        };
        const { user: person } = renderWithProviders(<Harness />);
        await signedIn();
        const writes = recordWrites();
        try {
          await person.click(
            screen.getByRole('button', { name: 'Sign in again' }),
          );
          await waitFor(() =>
            expect(screen.getByTestId('session')).toHaveTextContent(
              'authenticated',
            ),
          );
          await pause();
          await person.click(
            screen.getByRole('button', { name: 'Open the tab' }),
          );

          expect(await screen.findByText('ann')).toBeInTheDocument();
          await pause();
        } finally {
          writes.stop();
        }

        expect(reads).toBe(1);
      });
    });
  },
);
