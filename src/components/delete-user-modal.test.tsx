import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { DeleteUserModal } from './delete-user-modal';

const API = '/pulp/api/v3';

const user = { id: '7', username: 'zz-test-user' } as never;

function renderModal() {
  const addAlert = vi.fn();
  const closeModal = vi.fn();
  const view = renderWithProviders(
    <DeleteUserModal
      addAlert={addAlert}
      closeModal={closeModal}
      isOpen
      user={user}
    />,
  );
  return { addAlert, closeModal, ...view };
}

const confirm = () => screen.getByRole('button', { name: /Delete/ });

describe('deleting a user', () => {
  it('reports the failure of the delete request when it gets no answer', async () => {
    server.use(http.delete(`*${API}/users/7/`, () => HttpResponse.error()));
    const { addAlert, closeModal, user: actor } = renderModal();

    await actor.click(confirm());

    await waitFor(() =>
      expect(addAlert).toHaveBeenCalledWith(
        'User "zz-test-user" could not be deleted.',
        'danger',
        'Network Error',
      ),
    );
    expect(closeModal).toHaveBeenCalledWith(false);
  });

  it('reports a failure to confirm the deletion when the check gets no answer', async () => {
    server.use(
      http.delete(
        `*${API}/users/7/`,
        () => new HttpResponse(null, { status: 204 }),
      ),
      http.get(`*${API}/users/7/`, () => HttpResponse.error()),
    );
    const { addAlert, closeModal, user: actor } = renderModal();

    await actor.click(confirm());

    await waitFor(() =>
      expect(addAlert).toHaveBeenCalledWith(
        'User "zz-test-user" could not be deleted.',
        'danger',
        'Network Error',
      ),
    );
    expect(closeModal).not.toHaveBeenCalledWith(true);
  });

  it('reports success and closes once the user is gone', async () => {
    server.use(
      http.delete(
        `*${API}/users/7/`,
        () => new HttpResponse(null, { status: 204 }),
      ),
      http.get(`*${API}/users/7/`, () =>
        HttpResponse.json({ detail: 'Not found.' }, { status: 404 }),
      ),
    );
    const { addAlert, closeModal, user: actor } = renderModal();

    await actor.click(confirm());

    await waitFor(() => expect(closeModal).toHaveBeenCalledWith(true));
    expect(addAlert).toHaveBeenCalledWith(
      'User "zz-test-user" has been successfully deleted.',
      'success',
    );
  });
});
