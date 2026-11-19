import { act, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetSessionEvents } from 'src/session/session-events';
import { reacted } from 'src/test-utils/answered';
import { listOf, page } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import {
  SignInAgain,
  serveSignIn,
  signedIn,
} from 'src/test-utils/sign-in-again';
import { UserForm } from './user-form';

// The group field of the user form searches on the server and keeps the
// selected groups in the user the parent owns. These tests replace the search
// field with a plain one that reports every text typed, so the order of the
// answers and the objects handed to the parent are what is observed.
interface IMockTypeaheadProps {
  results: { name: string; id: number }[];
  loadResults: (text: string) => void;
  onSelect: (event: unknown, name: string) => void;
  selections: { name: string }[];
}

vi.mock('./typeahead', () => ({
  Typeahead: ({
    results,
    loadResults,
    onSelect,
    selections,
  }: IMockTypeaheadProps) => (
    <div>
      <input
        aria-label='group search'
        onChange={(event) => loadResults(event.target.value)}
      />
      <ul>
        {results.map((group) => (
          <li key={group.id}>
            <button
              type='button'
              onClick={(event) => onSelect(event, group.name)}
            >
              {group.name}
            </button>
          </li>
        ))}
      </ul>
      <button type='button' onClick={(event) => onSelect(event, 'missing')}>
        pick a group that is not listed
      </button>
      <p data-testid='selected'>
        {selections.map((group) => group?.name).join(',')}
      </p>
    </div>
  ),
}));

const GROUPS = '/pulp/api/v3/groups/';

// a group as Pulp answers it
const group = (name: string, id: number) => ({
  pulp_href: `${GROUPS}${id}/`,
  id,
  name,
});

afterEach(() => {
  resetSessionEvents();
});

interface IUser {
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  groups: { name: string; id: number }[];
}

// The parent owns the user, as the pages that use the form do. Every user the
// form hands over is recorded.
function renderForm(
  initial: IUser,
  props: { isMe?: boolean; isReadonly?: boolean } = {},
) {
  const handedOver: IUser[] = [];
  function Harness() {
    const [user, setUser] = useState(initial);
    return (
      <>
        <SignInAgain />
        <UserForm
          errorMessages={{}}
          isNewUser
          {...props}
          onCancel={() => null}
          saveUser={() => null}
          updateUser={(u) => {
            handedOver.push(u as never);
            setUser(u as never);
          }}
          user={user as never}
        />
      </>
    );
  }
  return { handedOver, ...renderWithProviders(<Harness />) };
}

const newUser = (): IUser => ({
  username: 'zoe',
  first_name: '',
  last_name: '',
  email: '',
  password: '',
  groups: [],
});

// A form that does not draw the group search asks the server for no group:
// what it does not show is not read.
describe('the groups a user form reads', () => {
  function recordGroupReads() {
    const reads: string[] = [];
    server.events.on('request:start', ({ request }) => {
      const { pathname } = new URL(request.url);
      if (pathname === GROUPS) {
        reads.push(pathname);
      }
    });
    server.use(listOf(GROUPS, [group('ops', 1)]).handler);
    return reads;
  }

  it('reads the first groups once for an editable form and offers them', async () => {
    const reads = recordGroupReads();
    renderForm(newUser());

    expect(await screen.findByRole('button', { name: 'ops' })).toBeVisible();
    await reacted();
    expect(reads).toHaveLength(1);
  });

  it('reads no group for a read-only form', async () => {
    const reads = recordGroupReads();
    renderForm(
      { ...newUser(), groups: [{ name: 'ops', id: 1 }] },
      { isReadonly: true },
    );

    expect(await screen.findByText('ops')).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(reads).toEqual([]);
  });

  it('reads no group for the form of the own profile', async () => {
    const reads = recordGroupReads();
    renderForm(
      { ...newUser(), groups: [{ name: 'ops', id: 1 }] },
      { isMe: true },
    );

    expect(await screen.findByText('ops')).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(reads).toEqual([]);
  });
});

describe('the group search of the user form', () => {
  it('lists the answer to the latest search when an earlier answer arrives last', async () => {
    let releaseFirst: () => void = () => undefined;
    const firstAnswer = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const searched: string[] = [];
    server.use(
      http.get(`*${GROUPS}`, async ({ request }) => {
        const text =
          new URL(request.url).searchParams.get('name__contains') ?? '';
        searched.push(text);
        if (text === 'a') {
          await firstAnswer;
          return HttpResponse.json(page([group('from-a', 1)]));
        }
        if (text === 'ab') {
          return HttpResponse.json(page([group('from-ab', 2)]));
        }
        return HttpResponse.json(page([]));
      }),
    );
    const { user } = renderForm(newUser());
    await waitFor(() => expect(searched).toEqual(['']));

    await user.type(screen.getByLabelText('group search'), 'ab');
    expect(await screen.findByText('from-ab')).toBeInTheDocument();
    await act(async () => {
      releaseFirst();
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(screen.getByText('from-ab')).toBeInTheDocument();
    expect(screen.queryByText('from-a')).toBeNull();
  });

  it('shows the search again once a read succeeds after an earlier one failed', async () => {
    serveSignIn();
    server.use(
      http.get(`*${GROUPS}`, () =>
        HttpResponse.json({ detail: 'broken' }, { status: 500 }),
      ),
    );
    const { user } = renderForm(newUser());
    expect(
      await screen.findByText('Groups list could not be displayed.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('group search')).toBeNull();
    await signedIn();
    server.use(listOf(GROUPS, [group('ops', 1)]).handler);

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));

    expect(await screen.findByText('ops')).toBeInTheDocument();
    expect(screen.getByLabelText('group search')).toBeVisible();
    expect(
      screen.queryByText('Groups list could not be displayed.'),
    ).toBeNull();
  });

  it('hands the parent a new groups list and leaves the previous one unchanged', async () => {
    server.use(listOf(GROUPS, [group('ops', 1)]).handler);
    const initial = newUser();
    const before = initial.groups;
    const { user, handedOver } = renderForm(initial);

    await user.click(await screen.findByRole('button', { name: 'ops' }));

    expect(before).toEqual([]);
    expect(handedOver).toHaveLength(1);
    expect(handedOver[0].groups).toEqual([{ name: 'ops', id: 1 }]);
    expect(handedOver[0].groups).not.toBe(before);
    expect(screen.getByTestId('selected')).toHaveTextContent('ops');
  });

  it('removes a selected group without changing the list the parent holds', async () => {
    server.use(listOf(GROUPS, [group('ops', 1)]).handler);
    const initial = { ...newUser(), groups: [{ name: 'ops', id: 1 }] };
    const before = initial.groups;
    const { user, handedOver } = renderForm(initial);

    await user.click(await screen.findByRole('button', { name: 'ops' }));

    expect(before).toEqual([{ name: 'ops', id: 1 }]);
    expect(handedOver[0].groups).toEqual([]);
    expect(screen.getByTestId('selected')).toHaveTextContent('');
  });

  it('adds nothing for a selection that is not in the current list', async () => {
    server.use(listOf(GROUPS, [group('ops', 1)]).handler);
    const { user, handedOver } = renderForm(newUser());
    await screen.findByRole('button', { name: 'ops' });

    await user.click(
      screen.getByRole('button', { name: 'pick a group that is not listed' }),
    );
    // nothing is read or written by a selection, so the screen only needs to
    // run the effects the click started
    await reacted();

    for (const handed of handedOver) {
      expect(handed.groups).not.toContain(undefined);
      expect(handed.groups).toEqual([]);
    }
    expect(screen.getByTestId('selected')).toHaveTextContent('');
  });
});
