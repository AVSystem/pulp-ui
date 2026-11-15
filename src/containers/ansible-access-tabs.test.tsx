import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { type ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { serveSignIn } from 'src/test-utils/sign-in-again';
import { ACTION_PERMISSIONS } from '../utilities/action-permissions';
import { RemoteAccessTab } from './ansible-remote/tab-access';
import { RepositoryAccessTab } from './ansible-repository/tab-access';

// Changing who holds which role on a repository or remote is offered only to
// users who may manage the roles of that object. The server decides every
// request; the controls are presentation.

const API = '/pulp/api/v3';
const ID = '00000000-0000-4000-8000-0000000000a1';

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

    function renderTab(held: string[]) {
      serveSignIn();
      server.use(
        http.get(`*${API}/${base}/${ID}/list_roles/`, () =>
          HttpResponse.json({
            roles: [{ role: 'viewer', users: ['ann'], groups: ['staff'] }],
          }),
        ),
      );
      const hasObjectPermission = vi.fn((name: string) => held.includes(name));
      renderWithProviders(
        <Tab
          item={item}
          actionContext={{
            addAlert: vi.fn(),
            hasObjectPermission,
            hasPermission: () => false,
            state: { params: {} },
            user: null,
          }}
        />,
      );
      return { hasObjectPermission };
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
  },
);
