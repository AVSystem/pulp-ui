import { screen, waitFor, within } from '@testing-library/react';
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
  const element = (isOpen: boolean) => (
    <DeleteUserModal
      addAlert={addAlert}
      closeModal={closeModal}
      isOpen={isOpen}
      user={user}
    />
  );
  const view = renderWithProviders(element(true));
  return {
    addAlert,
    closeModal,
    close: () => view.rerender(element(false)),
    ...view,
  };
}

// Serves a delete that is accepted and a user that stays readable until
// `remove` is called, counting the delete and read requests.
function serveSlowRemoval() {
  const requests = { deletes: 0, reads: 0 };
  let gone = false;
  server.use(
    http.delete(`*${API}/users/7/`, () => {
      requests.deletes += 1;
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(`*${API}/users/7/`, () => {
      requests.reads += 1;
      return gone
        ? HttpResponse.json({ detail: 'Not found.' }, { status: 404 })
        : HttpResponse.json({ id: 7, username: 'zz-test-user' });
    }),
  );
  return {
    requests,
    remove: () => {
      gone = true;
    },
  };
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

  it('sends one delete however often Delete is pressed and keeps it disabled with a spinner until the user is gone', async () => {
    const { requests, remove } = serveSlowRemoval();
    const { closeModal, user: actor } = renderModal();

    await actor.click(confirm());
    await waitFor(() => expect(requests.reads).toBeGreaterThan(0));
    await actor.click(confirm());
    await actor.click(confirm());

    expect(confirm()).toBeDisabled();
    expect(within(confirm()).getByRole('progressbar')).toBeTruthy();
    expect(requests.deletes).toBe(1);
    expect(closeModal).not.toHaveBeenCalled();

    remove();
    await waitFor(() => expect(closeModal).toHaveBeenCalledWith(true));
    expect(requests.deletes).toBe(1);
    expect(closeModal).toHaveBeenCalledTimes(1);
  });

  it('stops reading the user once the dialog is closed during the wait', async () => {
    const { requests } = serveSlowRemoval();
    const { close, user: actor } = renderModal();

    await actor.click(confirm());
    await waitFor(() => expect(requests.reads).toBeGreaterThan(0));
    close();
    // a read that was already on its way may still arrive
    await new Promise((resolve) => setTimeout(resolve, 100));
    const reads = requests.reads;
    await new Promise((resolve) => setTimeout(resolve, 1200));

    expect(requests.reads).toBe(reads);
  });

  it('stops reading the user once the dialog is removed during the wait', async () => {
    const { requests } = serveSlowRemoval();
    const { unmount, user: actor } = renderModal();

    await actor.click(confirm());
    await waitFor(() => expect(requests.reads).toBeGreaterThan(0));
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const reads = requests.reads;
    await new Promise((resolve) => setTimeout(resolve, 1200));

    expect(requests.reads).toBe(reads);
  });
});
