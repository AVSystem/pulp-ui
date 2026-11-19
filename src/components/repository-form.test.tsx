import { act, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { type ReactElement, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionEvents } from 'src/session/session-events';
import { answeredRequests } from 'src/test-utils/answered';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import { listOf, page, remote } from 'src/test-utils/pulp';
import { renderWithProviders as renderPlain } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import {
  SignInAgain,
  recordWrites,
  serveSignIn,
  signedIn,
} from 'src/test-utils/sign-in-again';
import { RepositoryForm } from './repository-form';

// The configuration is loaded once when the application starts, so a test that
// needs a different one replaces the module. The reserved prefixes are a
// made-up list, not those of any deployment.
// null stands for the fallback the application installs when the configuration
// could not be loaded; undefined for a served configuration that does not
// mention the list at all.
const settings = vi.hoisted(() => ({
  reservedPrefixes: [] as string[] | null | undefined,
}));

vi.mock('src/ui-config', () => ({
  configPromise: Promise.resolve(),
  configFallback: () => undefined,
  get config() {
    return {
      API_BASE_PATH: '/pulp/api/v3/',
      UI_BASE_PATH: '/ui/',
      ...(settings.reservedPrefixes === undefined
        ? {}
        : { RESERVED_BASE_PATH_PREFIXES: settings.reservedPrefixes }),
    };
  },
}));

const API = '/pulp/api/v3';

// Renders the form once the permissions of the signed-in user are known, as
// the application does. Unless a test serves other grants, the user is staff
// and holds every permission.
const renderWithProviders = (ui: ReactElement) =>
  renderPlain(<PermissionsKnown>{ui}</PermissionsKnown>);

beforeEach(() => {
  serveSignIn();
  settings.reservedPrefixes = [];
  server.use(
    listOf(`${API}/remotes/file/file/`, []).handler,
    listOf(`${API}/remotes/deb/apt/`, []).handler,
    listOf(`${API}/remotes/rpm/rpm/`, []).handler,
    listOf(`${API}/remotes/ansible/collection/`, []).handler,
    listOf(`${API}/remotes/python/python/`, []).handler,
    listOf(`${API}/distributions/file/file/`, []).handler,
    listOf(`${API}/publications/file/file/`, []).handler,
    http.get(`*${API}/status/`, () =>
      HttpResponse.json({
        content_settings: {
          content_origin: 'https://pulp.example',
          content_path_prefix: '/pulp/content/',
        },
      }),
    ),
  );
});

type Save = (options: { distribution: { basePath: string } | null }) => unknown;

// The form is controlled, so a small parent keeps the repository it edits the
// way the edit pages do.
function Harness({
  isNew,
  onSave,
  errorMessages = {},
  initial = {},
  plugin = 'file',
}: {
  isNew: boolean;
  onSave: Save;
  errorMessages?: Record<string, string>;
  initial?: Record<string, unknown>;
  plugin?: 'ansible' | 'deb' | 'file' | 'python' | 'rpm';
}) {
  const [repository, setRepository] = useState({
    name: isNew ? '' : 'existing',
    description: '',
    retain_repo_versions: null,
    pulp_labels: {},
    remote: null,
    pulp_href: isNew
      ? undefined
      : `${API}/repositories/file/file/00000000-0000-4000-8000-000000000001/`,
    ...initial,
  });

  return (
    <RepositoryForm
      allowEditName={isNew}
      errorMessages={errorMessages}
      isNew={isNew}
      onCancel={() => undefined}
      onSave={onSave as never}
      plugin={plugin}
      repository={repository as never}
      updateRepository={setRepository as never}
    />
  );
}

const distributionBox = () =>
  screen.queryByRole('checkbox', { name: /Create a distribution/ });
const saveButton = () => screen.getByRole('button', { name: 'Save' });
const basePathInput = () => screen.getByRole('textbox', { name: /Base path/ });
const retainInput = () => screen.getByRole('spinbutton', { name: /Retained/ });

describe('repository form, distribution option', () => {
  it('offers the create-distribution box unticked on create, with no base path field yet', async () => {
    renderWithProviders(<Harness isNew onSave={vi.fn()} />);

    const box = await screen.findByRole('checkbox', {
      name: /Create a distribution/,
    });

    expect(box).not.toBeChecked();
    expect(screen.queryByRole('textbox', { name: /Base path/ })).toBeNull();
  });

  it('shows the base path and the warning about a missing content guard once the box is ticked', async () => {
    const { user } = renderWithProviders(<Harness isNew onSave={vi.fn()} />);

    await user.click(
      await screen.findByRole('checkbox', { name: /Create a distribution/ }),
    );

    expect(basePathInput()).toBeInTheDocument();
    expect(screen.getByText(/no content guard/)).toBeInTheDocument();
  });

  it('follows the repository name for the base path until the user types one, and previews the server URL', async () => {
    const { user } = renderWithProviders(<Harness isNew onSave={vi.fn()} />);

    await user.type(
      await screen.findByRole('textbox', { name: /Name/ }),
      'tools',
    );
    await user.click(distributionBox());

    expect(basePathInput()).toHaveValue('tools');
    expect(
      await screen.findByText(
        'URL (preview): https://pulp.example/pulp/content/tools/',
      ),
    ).toBeInTheDocument();
  });

  it('previews no URL, and still works, when the status answer holds no content settings', async () => {
    server.use(
      http.get(`*${API}/status/`, () =>
        HttpResponse.json({ database_connection: { connected: true } }),
      ),
    );
    const { user } = renderWithProviders(<Harness isNew onSave={vi.fn()} />);

    await user.type(
      await screen.findByRole('textbox', { name: /Name/ }),
      'tools',
    );
    await user.click(distributionBox());

    expect(
      await screen.findByText(
        'The client URL is shown on the repository page once the distribution exists.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/URL \(preview\)/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('does not render the box or a base path field when editing, and Save asks for no distribution', async () => {
    const onSave = vi.fn();
    const { user } = renderWithProviders(
      <Harness isNew={false} onSave={onSave} />,
    );

    await screen.findByRole('button', { name: 'Save' });
    await user.click(saveButton());

    expect(distributionBox()).toBeNull();
    expect(screen.queryByRole('textbox', { name: /Base path/ })).toBeNull();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ distribution: null });
  });

  it('asks for a distribution at the typed base path only when the box is ticked', async () => {
    const onSave = vi.fn();
    const { user } = renderWithProviders(
      <Harness isNew onSave={onSave} initial={{ name: 'tools' }} />,
    );

    await user.click(await screen.findByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenLastCalledWith({ distribution: null });

    await user.click(distributionBox());
    await user.clear(basePathInput());
    await user.type(basePathInput(), 'tools/stable');
    await user.click(saveButton());

    expect(onSave).toHaveBeenLastCalledWith({
      distribution: { basePath: 'tools/stable' },
    });
  });
});

describe('repository form, name and distribution label', () => {
  it('marks Name required and disables Save while Name is empty', async () => {
    renderWithProviders(<Harness isNew onSave={vi.fn()} />);

    expect(await screen.findByRole('textbox', { name: /Name/ })).toBeRequired();
    expect(saveButton()).toBeDisabled();
  });

  it('enables Save once a name is typed', async () => {
    const { user } = renderWithProviders(<Harness isNew onSave={vi.fn()} />);

    await user.type(await screen.findByRole('textbox', { name: /Name/ }), 'a');

    expect(saveButton()).toBeEnabled();
  });

  it('words the distribution label generically while Name is empty', async () => {
    renderWithProviders(<Harness isNew onSave={vi.fn()} />);

    expect(
      await screen.findByRole('checkbox', {
        name: 'Create a distribution for this repository',
      }),
    ).toBeInTheDocument();
  });

  it('shows the typed name verbatim in the distribution label, quotes and non-ASCII letters included', async () => {
    const { user } = renderWithProviders(<Harness isNew onSave={vi.fn()} />);

    await user.type(
      await screen.findByRole('textbox', { name: /Name/ }),
      "O'Brien-\u017c\u00f3\u0142w",
    );

    expect(
      screen.getByRole('checkbox', {
        name: 'Create a distribution "O\'Brien-\u017c\u00f3\u0142w" for this repository',
      }),
    ).toBeInTheDocument();
  });

  it('shows markup typed into Name as plain text', async () => {
    const { user } = renderWithProviders(<Harness isNew onSave={vi.fn()} />);

    await user.type(
      await screen.findByRole('textbox', { name: /Name/ }),
      '<b>x</b>',
    );

    expect(
      screen.getByRole('checkbox', {
        name: 'Create a distribution "<b>x</b>" for this repository',
      }),
    ).toBeInTheDocument();
    expect(document.querySelector('label b')).toBeNull();
  });
});

describe('repository form, retained versions', () => {
  it('leaves the field empty for a repository that keeps every version', async () => {
    renderWithProviders(<Harness isNew onSave={vi.fn()} />);

    expect(
      await screen.findByRole('spinbutton', { name: /Retained/ }),
    ).toHaveValue(null);
  });

  it('shows the server field error under the field when the value was refused', async () => {
    renderWithProviders(
      <Harness
        isNew
        onSave={vi.fn()}
        initial={{ retain_repo_versions: '0' }}
        errorMessages={{
          retain_repo_versions:
            'Ensure this value is greater than or equal to 1.',
        }}
      />,
    );

    expect(
      await screen.findByText(/greater than or equal to 1/),
    ).toBeInTheDocument();
    expect(retainInput()).toHaveValue(0);
    expect(retainInput()).toHaveAttribute('aria-invalid', 'true');
  });

  it('keeps a typed 0 in the field instead of turning it into empty', async () => {
    const { user } = renderWithProviders(<Harness isNew onSave={vi.fn()} />);

    await user.type(
      await screen.findByRole('spinbutton', { name: /Retained/ }),
      '0',
    );

    expect(retainInput()).toHaveValue(0);
  });
});

describe('repository form, base path rules', () => {
  async function tickAndType(path: string) {
    const rendered = renderWithProviders(
      <Harness isNew onSave={vi.fn()} initial={{ name: 'zz-test-repo' }} />,
    );
    await rendered.user.click(
      await screen.findByRole('checkbox', { name: /Create a distribution/ }),
    );
    await rendered.user.clear(basePathInput());
    await rendered.user.type(basePathInput(), path);
    return rendered;
  }

  it('accepts a base path with a dot, a plus sign and a tilde', async () => {
    await tickAndType('tools-1.0/a+b~c');

    expect(screen.queryByText(/A base path cannot/)).toBeNull();
    expect(saveButton()).toBeEnabled();
  });

  it('keeps the dot when the base path follows a repository name', async () => {
    const { user } = renderWithProviders(<Harness isNew onSave={vi.fn()} />);

    await user.type(
      await screen.findByRole('textbox', { name: /Name/ }),
      'tools-1.0',
    );
    await user.click(distributionBox());

    expect(basePathInput()).toHaveValue('tools-1.0');
  });

  it('refuses a space and blocks Save with a reason', async () => {
    await tickAndType('a b');

    expect(
      screen.getByText('A base path cannot contain spaces, "?" or "#".'),
    ).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it('refuses a dot segment and blocks Save with a reason', async () => {
    await tickAndType('a/../b');

    expect(
      screen.getByText('A base path cannot contain a "." or ".." segment.'),
    ).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });
});

describe('repository form, reserved base paths', () => {
  async function tickAndType(path: string) {
    const rendered = renderWithProviders(
      <Harness isNew onSave={vi.fn()} initial={{ name: 'zz-test-repo' }} />,
    );
    await rendered.user.click(
      await screen.findByRole('checkbox', { name: /Create a distribution/ }),
    );
    await rendered.user.clear(basePathInput());
    await rendered.user.type(basePathInput(), path);
    return rendered;
  }

  it('refuses a base path under a configured reserved prefix with a message and blocks Save', async () => {
    settings.reservedPrefixes = ['reserved/'];

    await tickAndType('reserved/x');

    expect(
      screen.getByText(/Base paths starting with "reserved\/" are reserved/),
    ).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it('refuses the bare prefix itself as well', async () => {
    settings.reservedPrefixes = ['reserved/'];

    await tickAndType('reserved');

    expect(screen.getByText(/are reserved on this server/)).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it('accepts a base path outside the reserved prefixes and one that only shares the first letters', async () => {
    settings.reservedPrefixes = ['reserved/'];

    await tickAndType('reservedly/x');

    expect(screen.queryByText(/are reserved on this server/)).toBeNull();
    expect(saveButton()).toBeEnabled();
  });

  it('does not check the base path when no distribution is requested', async () => {
    settings.reservedPrefixes = ['reserved/'];
    const { user } = renderWithProviders(<Harness isNew onSave={vi.fn()} />);

    await user.type(
      await screen.findByRole('textbox', { name: /Name/ }),
      'reserved',
    );

    expect(screen.queryByText(/are reserved on this server/)).toBeNull();
    expect(saveButton()).toBeEnabled();
  });
});

describe('repository form, reserved base paths that are unknown', () => {
  const unknownReason = /reserved base paths of this server could not be read/;

  it.each([
    ['the configuration fell back to its defaults', null],
    ['the served configuration does not list them', undefined],
  ])(
    'disables the distribution option with a reason when %s',
    async (_case, prefixes) => {
      settings.reservedPrefixes = prefixes;

      renderWithProviders(<Harness isNew onSave={vi.fn()} />);

      expect(
        await screen.findByRole('checkbox', { name: /Create a distribution/ }),
      ).toBeDisabled();
      expect(screen.getByText(unknownReason)).toBeInTheDocument();
    },
  );

  it('still lets a repository be saved without a distribution', async () => {
    settings.reservedPrefixes = null;
    const onSave = vi.fn();
    const { user } = renderWithProviders(
      <Harness isNew onSave={onSave} initial={{ name: 'tools' }} />,
    );

    await user.click(await screen.findByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith({ distribution: null });
  });

  it('offers the distribution option when the deployment lists no reserved prefix', async () => {
    settings.reservedPrefixes = [];

    const { user } = renderWithProviders(
      <Harness isNew onSave={vi.fn()} initial={{ name: 'tools' }} />,
    );
    const box = await screen.findByRole('checkbox', {
      name: /Create a distribution/,
    });

    expect(box).toBeEnabled();
    expect(screen.queryByText(unknownReason)).toBeNull();

    await user.click(box);
    await user.clear(basePathInput());
    await user.type(basePathInput(), 'any/path');

    expect(saveButton()).toBeEnabled();
  });

  it('does not offer the option on the edit form, so the reason is not shown there', async () => {
    settings.reservedPrefixes = null;

    renderWithProviders(<Harness isNew={false} onSave={vi.fn()} />);

    await screen.findByRole('button', { name: 'Save' });
    expect(screen.queryByText(unknownReason)).toBeNull();
  });
});

describe('repository form, saving', () => {
  // a save that stays pending until the test lets it finish
  function pendingSave() {
    let finish: () => void = () => undefined;
    const onSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    return { onSave, finish: () => finish() };
  }

  it('calls the save handler once for a double click and keeps Save disabled until it ends', async () => {
    const { onSave, finish } = pendingSave();
    const { user } = renderWithProviders(
      <Harness isNew onSave={onSave} initial={{ name: 'tools' }} />,
    );

    await screen.findByRole('button', { name: 'Save' });
    await user.dblClick(saveButton());

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(saveButton()).toBeDisabled();

    await act(async () => finish());
    await waitFor(() => expect(saveButton()).toBeEnabled());
  });

  it('calls the save handler once when the second click arrives before the page has re-rendered', async () => {
    const { onSave } = pendingSave();
    renderWithProviders(
      <Harness isNew onSave={onSave} initial={{ name: 'tools' }} />,
    );

    const button = await screen.findByRole('button', { name: 'Save' });
    act(() => {
      button.click();
      button.click();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe('repository form, plugin specific fields', () => {
  it.each(['file', 'deb', 'rpm'] as const)(
    'offers no private checkbox for a %s repository',
    async (plugin) => {
      renderWithProviders(<Harness isNew onSave={vi.fn()} plugin={plugin} />);

      await screen.findByRole('textbox', { name: /Name/ });

      expect(
        screen.queryByRole('checkbox', { name: /Make private/ }),
      ).toBeNull();
    },
  );

  it('offers the private checkbox for an ansible repository', async () => {
    renderWithProviders(<Harness isNew onSave={vi.fn()} plugin='ansible' />);

    expect(
      await screen.findByRole('checkbox', { name: /Make private/ }),
    ).toBeInTheDocument();
  });

  it.each(['file', 'deb', 'rpm'] as const)(
    'offers autopublish unticked on the add form of a %s repository, with a line explaining it',
    async (plugin) => {
      renderWithProviders(<Harness isNew onSave={vi.fn()} plugin={plugin} />);

      const box = await screen.findByRole('checkbox', { name: /Publish new/ });
      expect(box).not.toBeChecked();
      expect(
        screen.getByText(/A ticked box publishes every new version/),
      ).toBeInTheDocument();
    },
  );

  it.each(['python', 'ansible'] as const)(
    'offers no autopublish for a %s repository',
    async (plugin) => {
      renderWithProviders(<Harness isNew onSave={vi.fn()} plugin={plugin} />);

      await screen.findByRole('textbox', { name: /Name/ });
      expect(
        screen.queryByRole('checkbox', { name: /Publish new/ }),
      ).toBeNull();
    },
  );
});

describe('repository form, remote choices', () => {
  it('shows a readable message instead of a spinner when the remotes request gets no answer', async () => {
    server.use(
      http.get(`*${API}/remotes/file/file/`, () => HttpResponse.error()),
    );

    renderWithProviders(<Harness isNew onSave={vi.fn()} />);

    expect(
      await screen.findByText(/Failed to load remotes: Network Error/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('keeps the status line in the message when the server answers an error', async () => {
    server.use(
      http.get(`*${API}/remotes/file/file/`, () =>
        HttpResponse.json({}, { status: 500, statusText: 'Broken' }),
      ),
    );

    renderWithProviders(<Harness isNew onSave={vi.fn()} />);

    expect(
      await screen.findByText(/Failed to load remotes: Error 500/),
    ).toBeInTheDocument();
  });

  it('keeps the name of the selected remote while a search lists other remotes and after the list cannot be reloaded', async () => {
    const chosen = remote({ name: 'mirror-one' });
    let reloads = 0;
    server.use(
      http.get(`*${API}/remotes/file/file/`, ({ request }) => {
        const text = new URL(request.url).searchParams.get('name__icontains');
        if (text === null) {
          reloads++;
          // The first answer lists the remote, the later full lists fail.
          return reloads === 1
            ? HttpResponse.json(page([chosen]))
            : HttpResponse.json({}, { status: 500 });
        }
        return HttpResponse.json(page([]));
      }),
    );

    const { user } = renderWithProviders(
      <Harness isNew onSave={vi.fn()} initial={{ remote: chosen.pulp_href }} />,
    );
    const box = await screen.findByRole('combobox', {
      name: 'Select a remote',
    });
    await waitFor(() => expect(box).toHaveValue('mirror-one'));

    await user.clear(box);
    await user.type(box, 'zz');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(reloads).toBeGreaterThanOrEqual(3));
    await waitFor(() => expect(box).toHaveValue('mirror-one'));
  });

  it('ignores the slow answer to an earlier remote search', async () => {
    const first = remote({ name: 'alpha-old' });
    const second = remote({ name: 'alpha-two-new' });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`*${API}/remotes/file/file/`, async ({ request }) => {
        const text = new URL(request.url).searchParams.get('name__icontains');
        if (text === 'al') {
          await gate;
          return HttpResponse.json(page([first]));
        }
        return HttpResponse.json(page(text === 'alp' ? [second] : []));
      }),
    );

    const { user } = renderWithProviders(<Harness isNew onSave={vi.fn()} />);
    const box = await screen.findByRole('combobox', {
      name: 'Select a remote',
    });

    await user.type(box, 'alp');
    await screen.findByRole('option', { name: 'alpha-two-new' });
    release();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(screen.queryByRole('option', { name: 'alpha-old' })).toBeNull();
    expect(screen.getByRole('option', { name: 'alpha-two-new' })).toBeVisible();
  });
});

describe('repository form after the same user signs in again', () => {
  afterEach(() => {
    resetSessionEvents();
  });

  const REMOTES = `${API}/remotes/file/file/`;
  const STATUS = `${API}/status/`;
  const signInAgain = (user) =>
    user.click(screen.getByRole('button', { name: 'Sign in again' }));
  const refused = (path: string) =>
    http.get(`*${path}`, () =>
      HttpResponse.json({ detail: 'no' }, { status: 401 }),
    );

  const renderForm = (isNew = true) => {
    serveSignIn();
    return renderWithProviders(
      <>
        <SignInAgain />
        <Harness isNew={isNew} onSave={vi.fn()} />
      </>,
    );
  };

  it('reads the remotes again and keeps what was typed', async () => {
    const first = listOf(REMOTES, [remote({ name: 'mirror-one' })]);
    server.use(first.handler);
    const { user } = renderForm();
    await waitFor(() => expect(first.queries).toHaveLength(1));
    await signedIn();
    await user.type(screen.getByRole('textbox', { name: /^Name/ }), 'tools');
    await user.type(
      screen.getByRole('textbox', { name: /Description/ }),
      'internal',
    );
    const second = listOf(REMOTES, [remote({ name: 'mirror-two' })]);
    server.use(second.handler);

    await signInAgain(user);

    await waitFor(() => expect(second.queries).toHaveLength(1));
    expect(screen.getByRole('textbox', { name: /^Name/ })).toHaveValue('tools');
    expect(screen.getByRole('textbox', { name: /Description/ })).toHaveValue(
      'internal',
    );
  });

  it('shows no remotes message when the read is refused with 401, and no write is sent', async () => {
    server.use(listOf(REMOTES, []).handler);
    const recorded = recordWrites();
    const { user } = renderForm();
    await signedIn();
    server.use(refused(REMOTES));
    const refusals = answeredRequests(REMOTES);

    await signInAgain(user);
    await refusals.untilAnswered();

    expect(screen.queryByText(/Failed to load remotes/)).toBeNull();
    expect(recorded.writes).toEqual([`POST ${API}/login/`]);
    recorded.stop();
  });

  it('shows no remotes message when the first read is refused with 401, and reads after signing in', async () => {
    server.use(refused(REMOTES));
    const refusals = answeredRequests(REMOTES);
    const { user } = renderForm();
    await signedIn();
    await refusals.untilAnswered();
    expect(screen.queryByText(/Failed to load remotes/)).toBeNull();
    const served = listOf(REMOTES, [remote({ name: 'mirror-one' })]);
    server.use(served.handler);

    await signInAgain(user);

    await waitFor(() => expect(served.queries).toHaveLength(1));
  });

  it('reads the URL preview again after a refused read', async () => {
    server.use(refused(STATUS));
    const refusals = answeredRequests(STATUS);
    const { user } = renderForm();
    await signedIn();
    await user.click(
      screen.getByRole('checkbox', { name: /Create a distribution/ }),
    );
    await refusals.untilAnswered();
    expect(screen.queryByText(/URL \(preview\)/)).toBeNull();
    expect(screen.queryByText(/The client URL is shown/)).toBeNull();
    server.use(
      http.get(`*${STATUS}`, () =>
        HttpResponse.json({
          content_settings: {
            content_origin: 'https://pulp.example',
            content_path_prefix: '/pulp/content/',
          },
        }),
      ),
    );

    await signInAgain(user);

    expect(await screen.findByText(/URL \(preview\)/)).toBeInTheDocument();
  });
});

// The create-distribution option is offered only to users who may add a
// distribution of the plugin. Pulp decides every request; the option is
// presentation.
describe('repository form, who is offered a distribution', () => {
  const PLUGINS = [
    ['file', 'file.add_filedistribution'],
    ['deb', 'deb.add_aptdistribution'],
    ['rpm', 'rpm.add_rpmdistribution'],
    ['python', 'python.add_pythondistribution'],
    ['ansible', 'ansible.add_ansibledistribution'],
  ] as const;

  describe.each(PLUGINS)('for %s', (plugin, addDistribution) => {
    it('shows the option to a user who holds the add permission', async () => {
      servePermissions({ own: [[addDistribution]] });
      renderWithProviders(<Harness isNew plugin={plugin} onSave={vi.fn()} />);

      expect(
        await screen.findByRole('checkbox', { name: /Create a distribution/ }),
      ).toBeInTheDocument();
    });

    it('does not render the option for a viewer, and Save asks for no distribution', async () => {
      servePermissions({ own: [[`${plugin}.view_${plugin}repository`]] });
      const onSave = vi.fn();
      const { user } = renderWithProviders(
        <Harness
          isNew
          plugin={plugin}
          initial={{ name: 'tools' }}
          onSave={onSave}
        />,
      );

      await user.click(await screen.findByRole('button', { name: 'Save' }));

      expect(distributionBox()).toBeNull();
      expect(screen.queryByText('Distributions')).toBeNull();
      expect(onSave).toHaveBeenCalledWith({ distribution: null });
    });
  });

  it('does not take the permission to add a repository for the one to add a distribution', async () => {
    servePermissions({ own: [['file.add_filerepository']] });
    renderWithProviders(<Harness isNew onSave={vi.fn()} />);

    await screen.findByRole('button', { name: 'Save' });

    expect(distributionBox()).toBeNull();
  });

  it('shows the option to staff, who hold every permission', async () => {
    servePermissions({ isStaff: true });
    renderWithProviders(<Harness isNew onSave={vi.fn()} />);

    expect(
      await screen.findByRole('checkbox', { name: /Create a distribution/ }),
    ).toBeInTheDocument();
  });

  it('does not render the option while nobody is signed in', async () => {
    server.use(
      http.get(`*${API}/login/`, () =>
        HttpResponse.json({ detail: 'no' }, { status: 401 }),
      ),
    );
    renderPlain(<Harness isNew onSave={vi.fn()} />);

    await screen.findByRole('button', { name: 'Save' });

    expect(distributionBox()).toBeNull();
  });
});

describe('repository form, message that belongs to no field', () => {
  it('shows a long unbroken refusal as a paragraph that wraps', async () => {
    const refusal = `You do not have permission to do this. ${'x'.repeat(500)} Contact your organization administrator for more information.`;
    renderWithProviders(
      <Harness isNew onSave={vi.fn()} errorMessages={{ __nofield: refusal }} />,
    );

    const message = await screen.findByText(refusal);
    expect(message.tagName).toBe('P');
    expect(message).toHaveClass('pulp-break-anywhere');
  });
});
