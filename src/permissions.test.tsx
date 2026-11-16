import { act, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { usePermissions } from './permissions';
import { servePermissions } from './test-utils/permissions';
import { renderWithProviders } from './test-utils/render';
import { server } from './test-utils/server';
import { useUserContext } from './user-context';

const API = '/pulp/api/v3';

const NAMES = [
  'file.change_filerepository',
  'file.sync_filerepository',
  'rpm.change_rpmrepository',
  'rpm.add_rpmremote',
];

// Shows what the provider says for a few permission names, and offers the
// buttons a session change and a route change would press.
function Probe() {
  const permissions = usePermissions();
  const { logout, setUser, signInAgain, status } = useUserContext();

  return (
    <>
      <p data-testid='session'>{status}</p>
      <p data-testid='state'>
        {permissions.state}
        {permissions.state === 'unknown' && permissions.failed ? ' failed' : ''}
      </p>
      {NAMES.map((name) => (
        <p key={name} data-testid={name}>
          {permissions.hasPermission(name) ? 'yes' : 'no'}
        </p>
      ))}
      <button type='button' onClick={() => signInAgain('zoe', 'secret')}>
        Sign in again
      </button>
      <button
        type='button'
        onClick={() =>
          setUser({ username: 'amy', pulp_href: `${API}/users/9/` })
        }
      >
        Become amy
      </button>
      <button type='button' onClick={() => logout()}>
        Sign out
      </button>
      <button type='button' onClick={permissions.retryIfFailed}>
        Retry if failed
      </button>
      <button type='button' onClick={permissions.retry}>
        Retry
      </button>
      <p data-testid='error'>
        {permissions.state === 'unknown' && permissions.error
          ? String((permissions.error as Error).message ?? 'error')
          : 'none'}
      </p>
    </>
  );
}

const state = () => screen.getByTestId('state');
const answer = (name: string) => screen.getByTestId(name);
const ready = () => waitFor(() => expect(state()).toHaveTextContent(/^ready$/));

let recorder: { requests: string[]; stop: () => void } | undefined;

afterEach(() => {
  recorder?.stop();
  recorder = undefined;
});

describe('the permission provider', () => {
  it('knows nothing and sends no request while nobody is signed in', async () => {
    const asked: string[] = [];
    server.events.on('request:start', ({ request }) =>
      asked.push(new URL(request.url).pathname),
    );
    renderWithProviders(<Probe />);

    await waitFor(() =>
      expect(screen.getByTestId('session')).toHaveTextContent('anonymous'),
    );
    expect(state()).toHaveTextContent(/^unknown$/);
    for (const name of NAMES) {
      expect(answer(name)).toHaveTextContent('no');
    }
    expect(asked.filter((path) => /\/(users|groups)\//.test(path))).toEqual([]);
    server.events.removeAllListeners();
  });

  it('denies every check while the reads are pending', async () => {
    recorder = servePermissions({ own: [['file.sync_filerepository']] });
    server.use(
      http.get(`*${API}/users/7/`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return HttpResponse.json({ id: 7, is_staff: true, groups: [] });
      }),
    );
    renderWithProviders(<Probe />);

    await waitFor(() =>
      expect(screen.getByTestId('session')).toHaveTextContent('authenticated'),
    );
    expect(state()).toHaveTextContent(/^unknown$/);
    expect(answer('file.sync_filerepository')).toHaveTextContent('no');
    await ready();
    expect(answer('file.sync_filerepository')).toHaveTextContent('yes');
  });

  it('lets a staff user pass every check and reads no roles', async () => {
    recorder = servePermissions({ isStaff: true });
    renderWithProviders(<Probe />);

    await ready();
    for (const name of NAMES) {
      expect(answer(name)).toHaveTextContent('yes');
    }
    expect(recorder.requests).toEqual([`${API}/users/7/`]);
  });

  it('allows what the roles of the user and of their groups grant, and nothing else', async () => {
    recorder = servePermissions({
      own: [['file.change_filerepository'], ['file.sync_filerepository']],
      groups: [
        { id: 3, roles: [['rpm.change_rpmrepository']] },
        { id: 4, roles: [] },
      ],
    });
    renderWithProviders(<Probe />);

    await ready();
    expect(answer('file.change_filerepository')).toHaveTextContent('yes');
    expect(answer('file.sync_filerepository')).toHaveTextContent('yes');
    expect(answer('rpm.change_rpmrepository')).toHaveTextContent('yes');
    expect(answer('rpm.add_rpmremote')).toHaveTextContent('no');
  });

  it('reads the own record, the own roles and the roles of every group without an object', async () => {
    recorder = servePermissions({
      groups: [
        { id: 3, roles: [] },
        { id: 4, roles: [] },
      ],
    });
    renderWithProviders(<Probe />);

    await ready();
    const paths = recorder.requests.map((request) => request.split('?')[0]);
    expect(paths.sort()).toEqual(
      [
        `${API}/users/7/`,
        `${API}/users/7/roles/`,
        `${API}/groups/3/roles/`,
        `${API}/groups/4/roles/`,
      ].sort(),
    );
    for (const request of recorder.requests.filter((r) =>
      r.includes('/roles/'),
    )) {
      expect(
        new URLSearchParams(request.split('?')[1]).get('content_object'),
      ).toBe('null');
    }
  });

  it('reads every page of a long role list', async () => {
    const roles = Array.from({ length: 600 }, (_, i) => [`file.perm_${i}`]);
    recorder = servePermissions({ own: roles });
    renderWithProviders(<Probe />);

    await ready();
    expect(
      recorder.requests.filter((r) => r.includes('/users/7/roles/')).length,
    ).toBeGreaterThan(1);
  });

  it.each([403, 500])(
    'stays unknown and failed, with every check denied, when a read answers %i',
    async (status) => {
      recorder = servePermissions({
        own: [['file.sync_filerepository']],
        groups: [{ id: 3, roles: [['rpm.change_rpmrepository']] }],
      });
      server.use(
        http.get(`*${API}/groups/3/roles/`, () =>
          HttpResponse.json({ detail: 'no' }, { status }),
        ),
      );
      renderWithProviders(<Probe />);

      await waitFor(() => expect(state()).toHaveTextContent('unknown failed'));
      for (const name of NAMES) {
        expect(answer(name)).toHaveTextContent('no');
      }
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );

  it('stays unknown and failed when the own record cannot be read', async () => {
    recorder = servePermissions({ isStaff: true });
    server.use(
      http.get(`*${API}/users/7/`, () =>
        HttpResponse.json({ detail: 'no' }, { status: 403 }),
      ),
    );
    renderWithProviders(<Probe />);

    await waitFor(() => expect(state()).toHaveTextContent('unknown failed'));
    expect(answer('file.sync_filerepository')).toHaveTextContent('no');
  });

  it('reads again only after a failure, when asked to retry', async () => {
    recorder = servePermissions({ own: [['file.sync_filerepository']] });
    let failing = true;
    server.use(
      http.get(`*${API}/users/7/roles/`, () =>
        failing
          ? HttpResponse.json({ detail: 'no' }, { status: 500 })
          : HttpResponse.json({
              count: 1,
              next: null,
              previous: null,
              results: [{ permissions: ['file.sync_filerepository'] }],
            }),
      ),
    );
    const { user } = renderWithProviders(<Probe />);
    await waitFor(() => expect(state()).toHaveTextContent('unknown failed'));

    failing = false;
    await user.click(screen.getByRole('button', { name: 'Retry if failed' }));

    await ready();
    expect(answer('file.sync_filerepository')).toHaveTextContent('yes');

    const before = recorder.requests.length;
    await user.click(screen.getByRole('button', { name: 'Retry if failed' }));
    expect(recorder.requests).toHaveLength(before);
  });

  it('does not read again when asked to retry while nothing failed', async () => {
    recorder = servePermissions({ own: [['file.sync_filerepository']] });
    const { user } = renderWithProviders(<Probe />);
    await ready();

    const before = recorder.requests.length;
    await user.click(screen.getByRole('button', { name: 'Retry if failed' }));
    expect(recorder.requests).toHaveLength(before);
  });

  it('keeps the ready state and its answers while the same user signs in again and the read is pending, then takes the new answers', async () => {
    recorder = servePermissions({ own: [['file.sync_filerepository']] });
    const { user } = renderWithProviders(<Probe />);
    await ready();
    expect(answer('rpm.add_rpmremote')).toHaveTextContent('no');

    let release: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    server.use(
      http.get(`*${API}/users/7/`, async () => {
        reads += 1;
        await held;
        return HttpResponse.json({ id: 7, is_staff: true, groups: [] });
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Sign in again' }));

    await waitFor(() => expect(reads).toBe(1));
    // the read is pending: nothing was reset
    expect(state()).toHaveTextContent(/^ready$/);
    expect(answer('file.sync_filerepository')).toHaveTextContent('yes');
    expect(answer('rpm.add_rpmremote')).toHaveTextContent('no');

    release();
    await waitFor(() =>
      expect(answer('rpm.add_rpmremote')).toHaveTextContent('yes'),
    );
    expect(state()).toHaveTextContent(/^ready$/);
  });

  it('never shows the unknown state between the answers of a same-user re-read', async () => {
    recorder = servePermissions({ own: [['file.sync_filerepository']] });
    const { user } = renderWithProviders(<Probe />);
    await ready();

    const seen: string[] = [];
    const observer = new MutationObserver(() =>
      seen.push(state().textContent ?? ''),
    );
    observer.observe(state(), {
      childList: true,
      characterData: true,
      subtree: true,
    });
    await user.click(screen.getByRole('button', { name: 'Sign in again' }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
    observer.disconnect();

    expect(seen.filter((text) => text !== 'ready')).toEqual([]);
  });

  it('resets to unknown at once when the session belongs to another user', async () => {
    recorder = servePermissions({ own: [['file.sync_filerepository']] });
    const { user } = renderWithProviders(<Probe />);
    await ready();

    server.use(
      http.get(`*${API}/users/9/`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return HttpResponse.json({ id: 9, is_staff: false, groups: [] });
      }),
      http.get(`*${API}/users/9/roles/`, () =>
        HttpResponse.json({
          count: 0,
          next: null,
          previous: null,
          results: [],
        }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Become amy' }));

    await waitFor(() => expect(state()).toHaveTextContent(/^unknown$/));
    expect(answer('file.sync_filerepository')).toHaveTextContent('no');
    await ready();
    expect(answer('file.sync_filerepository')).toHaveTextContent('no');
  });

  it('ends a failed same-user re-read as unknown and failed with the error kept, and reads again on retry', async () => {
    recorder = servePermissions({ own: [['file.sync_filerepository']] });
    const { user } = renderWithProviders(<Probe />);
    await ready();

    let failing = true;
    server.use(
      http.get(`*${API}/users/7/`, () =>
        failing
          ? HttpResponse.json({ detail: 'down' }, { status: 500 })
          : HttpResponse.json({ id: 7, is_staff: true, groups: [] }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Sign in again' }));

    await waitFor(() => expect(state()).toHaveTextContent('unknown failed'));
    expect(screen.getByTestId('error')).not.toHaveTextContent(/^none$/);
    expect(answer('file.sync_filerepository')).toHaveTextContent('no');

    failing = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await ready();
    expect(answer('rpm.add_rpmremote')).toHaveTextContent('yes');
  });

  it('forgets everything once the user signs out', async () => {
    recorder = servePermissions({ isStaff: true });
    server.use(
      http.delete(
        `*${API}/login/`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    const { user } = renderWithProviders(<Probe />);
    await ready();
    expect(answer('rpm.add_rpmremote')).toHaveTextContent('yes');

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(state()).toHaveTextContent(/^unknown$/));
    expect(answer('rpm.add_rpmremote')).toHaveTextContent('no');
  });
});
