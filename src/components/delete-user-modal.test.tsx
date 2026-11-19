import { render, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetSessionEvents } from 'src/session/session-events';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { DeleteUserModal } from './delete-user-modal';

const API = '/pulp/api/v3';

const zoe = { pulp_href: `${API}/users/7/`, username: 'zz-test-user' };
const ann = { pulp_href: `${API}/users/8/`, username: 'zz-other-user' };

type Target = typeof zoe;

afterEach(() => {
  resetSessionEvents();
});

function renderModal(options: { signedIn?: boolean } = {}) {
  const addAlert = vi.fn();
  const closeModal = vi.fn();
  const element = (isOpen: boolean, target: Target = zoe) => (
    <DeleteUserModal
      addAlert={addAlert}
      closeModal={closeModal}
      isOpen={isOpen}
      user={target}
    />
  );
  const view = renderWithProviders(element(true), options);
  return {
    addAlert,
    closeModal,
    close: () => view.rerender(element(false)),
    open: (target: Target) => view.rerender(element(true, target)),
    ...view,
  };
}

// Serves a delete that is accepted and a user that stays readable until
// `remove` is called, counting the delete and read requests of one user.
function serveSlowRemoval(id = 7) {
  const requests = { deletes: 0, reads: 0 };
  let gone = false;
  server.use(
    http.delete(`*${API}/users/${id}/`, () => {
      requests.deletes += 1;
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(`*${API}/users/${id}/`, () => {
      requests.reads += 1;
      return gone
        ? HttpResponse.json({ detail: 'Not found.' }, { status: 404 })
        : HttpResponse.json({ id, username: 'zz-test-user' });
    }),
  );
  return {
    requests,
    remove: () => {
      gone = true;
    },
  };
}

const serveRemoved = (id = 7) =>
  server.use(
    http.delete(
      `*${API}/users/${id}/`,
      () => new HttpResponse(null, { status: 204 }),
    ),
    http.get(`*${API}/users/${id}/`, () =>
      HttpResponse.json({ detail: 'Not found.' }, { status: 404 }),
    ),
  );

const confirm = () => screen.getByRole('button', { name: /Delete/ });
// the removal is confirmed every half second
const SLOW = { timeout: 4000 };

describe('deleting a user', () => {
  it('reports the failure of the delete request when it gets no answer', async () => {
    server.use(http.delete(`*${API}/users/7/`, () => HttpResponse.error()));
    const { addAlert, closeModal, user: actor } = renderModal();

    await actor.click(confirm());

    await waitFor(() =>
      expect(addAlert).toHaveBeenCalledWith(
        'User "zz-test-user" could not be deleted.',
        'danger',
        expect.stringMatching(/network|failed|fetch/i),
      ),
    );
    expect(closeModal).toHaveBeenCalledWith(false);
  });

  it('reports a refused delete with the three-part refusal text and closes', async () => {
    server.use(
      http.delete(`*${API}/users/7/`, () =>
        HttpResponse.json({ detail: 'Not for you.' }, { status: 403 }),
      ),
    );
    const { addAlert, closeModal, user: actor } = renderModal();

    await actor.click(confirm());

    await waitFor(() => expect(addAlert).toHaveBeenCalledTimes(1));
    const [title, variant, description] = addAlert.mock.calls[0];
    expect(title).toBe('User "zz-test-user" could not be deleted.');
    expect(variant).toBe('danger');
    render(<div data-testid='description'>{description}</div>);
    const shown = within(screen.getByTestId('description'));
    expect(
      shown.getByText('You do not have permission to do this.'),
    ).toBeInTheDocument();
    expect(shown.getByText('Not for you.')).toBeInTheDocument();
    expect(
      shown.getByText(
        'Contact your organization administrator for more information.',
      ),
    ).toBeInTheDocument();
    expect(closeModal).toHaveBeenCalledWith(false);
  });

  it('adds nothing and keeps the dialog when the session ends before the delete is answered', async () => {
    server.use(
      http.delete(`*${API}/users/7/`, () =>
        HttpResponse.json({ detail: 'no' }, { status: 401 }),
      ),
    );
    const {
      addAlert,
      closeModal,
      user: actor,
    } = renderModal({ signedIn: true });

    await actor.click(confirm());

    await waitFor(() => expect(confirm()).toBeEnabled());
    expect(addAlert).not.toHaveBeenCalled();
    expect(closeModal).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('reports a failure to confirm the deletion when the check gets no answer, and keeps the dialog', async () => {
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
        expect.stringMatching(/network|failed|fetch/i),
      ),
    );
    expect(closeModal).not.toHaveBeenCalledWith(true);
  });

  it('reports success and closes once the user is gone', async () => {
    serveRemoved();
    const { addAlert, closeModal, user: actor } = renderModal();

    await actor.click(confirm());

    await waitFor(() => expect(closeModal).toHaveBeenCalledWith(true));
    expect(addAlert).toHaveBeenCalledWith(
      'User "zz-test-user" has been successfully deleted.',
      'success',
    );
    expect(addAlert).toHaveBeenCalledTimes(1);
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
    await waitFor(() => expect(closeModal).toHaveBeenCalledWith(true), SLOW);
    expect(requests.deletes).toBe(1);
    expect(closeModal).toHaveBeenCalledTimes(1);
  });

  it('still reports the success when the dialog is closed during the confirmation', async () => {
    const { requests, remove } = serveSlowRemoval();
    const { addAlert, close, closeModal, user: actor } = renderModal();

    await actor.click(confirm());
    await waitFor(() => expect(requests.reads).toBeGreaterThan(0));
    close();
    expect(screen.queryByRole('dialog')).toBeNull();
    remove();

    await waitFor(
      () =>
        expect(addAlert).toHaveBeenCalledWith(
          'User "zz-test-user" has been successfully deleted.',
          'success',
        ),
      SLOW,
    );
    expect(addAlert).toHaveBeenCalledTimes(1);
    expect(requests.deletes).toBe(1);
    // the dialog was already closed by whoever closed it
    expect(closeModal).not.toHaveBeenCalled();
  });

  it('still reports the success when the dialog is removed during the confirmation', async () => {
    const { requests, remove } = serveSlowRemoval();
    const { addAlert, unmount, user: actor } = renderModal();

    await actor.click(confirm());
    await waitFor(() => expect(requests.reads).toBeGreaterThan(0));
    unmount();
    remove();

    await waitFor(
      () =>
        expect(addAlert).toHaveBeenCalledWith(
          'User "zz-test-user" has been successfully deleted.',
          'success',
        ),
      SLOW,
    );
  });

  it('gives a dialog opened for another user nothing of the earlier confirmation', async () => {
    const first = serveSlowRemoval(7);
    const { addAlert, close, closeModal, open, user: actor } = renderModal();

    await actor.click(confirm());
    await waitFor(() => expect(first.requests.reads).toBeGreaterThan(0));
    close();
    open(ann);

    // no spinner, and Delete is available for the other user
    expect(screen.getByText('zz-other-user')).toBeInTheDocument();
    expect(confirm()).toBeEnabled();
    expect(within(confirm()).queryByRole('progressbar')).toBeNull();

    first.remove();
    await waitFor(
      () =>
        expect(addAlert).toHaveBeenCalledWith(
          'User "zz-test-user" has been successfully deleted.',
          'success',
        ),
      SLOW,
    );
    // the earlier confirmation neither closes nor changes the other dialog
    expect(closeModal).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(confirm()).toBeEnabled();
    expect(addAlert).toHaveBeenCalledTimes(1);

    // the other user can still be deleted, with a request of its own
    serveRemoved(8);
    await actor.click(confirm());
    await waitFor(() => expect(closeModal).toHaveBeenCalledWith(true));
    expect(addAlert).toHaveBeenLastCalledWith(
      'User "zz-other-user" has been successfully deleted.',
      'success',
    );
    expect(first.requests.deletes).toBe(1);
  });

  it('closes without an alert when the session ends while the removal is confirmed', async () => {
    let reads = 0;
    server.use(
      http.delete(
        `*${API}/users/7/`,
        () => new HttpResponse(null, { status: 204 }),
      ),
      http.get(`*${API}/users/7/`, () => {
        reads += 1;
        return HttpResponse.json({ detail: 'no' }, { status: 401 });
      }),
    );
    const {
      addAlert,
      closeModal,
      user: actor,
    } = renderModal({ signedIn: true });

    await actor.click(confirm());

    await waitFor(() => expect(closeModal).toHaveBeenCalledWith(true));
    expect(reads).toBe(1);
    expect(addAlert).not.toHaveBeenCalled();
  });
});
