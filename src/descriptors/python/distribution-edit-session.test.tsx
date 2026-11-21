import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetSessionEvents } from 'src/session/session-events';
import { answeredRequests, reacted } from 'src/test-utils/answered';
import {
  listOf,
  pluginRemote,
  projectedBy,
  pythonDistribution,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import {
  SignInAgain,
  recordWrites,
  serveSignIn,
  signedIn,
} from 'src/test-utils/sign-in-again';
import { PythonDistributionEdit } from './distribution-edit';

// What the Edit distribution dialog must do once the session has ended: read
// the distribution again when the same user signs in again, keep what the user
// changed, and show no error for a read that failed only because the session
// ended.

const API = '/pulp/api/v3';
const REMOTES = `${API}/remotes/python/python/`;
const dist = pythonDistribution({ base_path: 'pypi-local' });

afterEach(() => {
  resetSessionEvents();
});

const refused = (path: string) =>
  http.get(`*${path}`, () =>
    HttpResponse.json({ detail: 'no' }, { status: 401 }),
  );

const serveDistribution = (fields: Record<string, unknown> = {}) =>
  server.use(
    http.get(`*${dist.pulp_href}`, () =>
      HttpResponse.json({ ...dist, ...fields }),
    ),
  );

const serveRemotes = (...names: string[]) => {
  const served = listOf(
    REMOTES,
    names.map((name) => pluginRemote('python', { name })),
    { projected: projectedBy },
  );
  server.use(served.handler);
  return served.queries;
};

function Dialog() {
  return (
    <>
      <SignInAgain />
      <PythonDistributionEdit
        distribution={dist as never}
        onClose={vi.fn()}
        addAlert={vi.fn()}
      />
    </>
  );
}

// an open modal hides the rest of the page from the accessibility tree
const signInAgain = (user: ReturnType<typeof renderWithProviders>['user']) =>
  user.click(
    screen.getByRole('button', { name: 'Sign in again', hidden: true }),
  );

const uploads = () =>
  screen.getByRole('checkbox', { name: /Allow uploads/, hidden: true });

describe(
  'Integration: the edit dialog of a python distribution after the session ended',
  { tags: ['integration'] },
  () => {
    it('reads the distribution again and shows the fresh value when the form is untouched', async () => {
      serveSignIn();
      serveDistribution({ allow_uploads: true });
      serveRemotes();
      const { user } = renderWithProviders(<Dialog />, { signedIn: true });
      await waitFor(() => expect(uploads()).toBeChecked());
      await signedIn();
      serveDistribution({ allow_uploads: false });

      await signInAgain(user);

      await waitFor(() => expect(uploads()).not.toBeChecked());
    });

    it('keeps what the user changed and sends no write', async () => {
      serveSignIn();
      serveDistribution({ allow_uploads: true });
      const queries = serveRemotes('mirror');
      const recorded = recordWrites();
      const { user } = renderWithProviders(<Dialog />, { signedIn: true });
      await waitFor(() => expect(uploads()).toBeChecked());
      await signedIn();
      await user.click(uploads());
      expect(uploads()).not.toBeChecked();
      const before = queries.length;
      serveDistribution({ allow_uploads: true });

      await signInAgain(user);
      await waitFor(() => expect(queries.length).toBeGreaterThan(before));
      await reacted();

      expect(uploads()).not.toBeChecked();
      expect(recorded.writes).toEqual([`POST ${API}/login/`]);
      recorded.stop();
    });

    it('keeps the form, with no error, when the read is refused with 401', async () => {
      serveSignIn();
      serveDistribution({ allow_uploads: true });
      serveRemotes();
      const { user } = renderWithProviders(<Dialog />, { signedIn: true });
      await waitFor(() => expect(uploads()).toBeChecked());
      await signedIn();
      server.use(refused(dist.pulp_href), refused(REMOTES));

      const answers = answeredRequests(dist.pulp_href);
      await signInAgain(user);
      await answers.untilAnswered();

      expect(uploads()).toBeChecked();
      expect(screen.queryByText(/Failed to load/)).toBeNull();
    });

    it('keeps the spinner, with no error, when the first read is refused, and shows the form after signing in', async () => {
      serveSignIn();
      server.use(refused(dist.pulp_href), refused(REMOTES));
      const answers = answeredRequests(dist.pulp_href);
      const { user } = renderWithProviders(<Dialog />, { signedIn: true });
      await signedIn();
      await answers.untilAnswered();
      expect(screen.getByRole('progressbar')).toBeVisible();
      expect(screen.queryByText(/Failed to load/)).toBeNull();
      serveDistribution({ allow_uploads: true });
      serveRemotes();

      await signInAgain(user);

      await waitFor(() => expect(uploads()).toBeChecked());
    });

    it('still shows the failure when the read fails for another reason', async () => {
      serveSignIn();
      server.use(
        http.get(`*${dist.pulp_href}`, () =>
          HttpResponse.json({ detail: 'broken' }, { status: 500 }),
        ),
      );
      serveRemotes();
      renderWithProviders(<Dialog />, { signedIn: true });

      expect(
        await screen.findByText(/Failed to load the distribution/),
      ).toBeInTheDocument();
    });
  },
);
