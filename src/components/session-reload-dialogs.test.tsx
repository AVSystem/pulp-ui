import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { resetSessionEvents } from 'src/session/session-events';
import { listOf } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import {
  SignInAgain,
  recordWrites,
  serveSignIn,
  signedIn,
} from 'src/test-utils/sign-in-again';
import { SelectRoles } from './select-roles';

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
