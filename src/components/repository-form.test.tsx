import { act, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listOf } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { RepositoryForm } from './repository-form';

// The configuration is loaded once when the application starts, so a test that
// needs a different one replaces the module. The reserved prefixes are a
// made-up list, not those of any deployment.
const settings = vi.hoisted(() => ({ reservedPrefixes: [] as string[] }));

vi.mock('src/ui-config', () => ({
  configPromise: Promise.resolve(),
  configFallback: () => undefined,
  get config() {
    return {
      API_BASE_PATH: '/pulp/api/v3/',
      UI_BASE_PATH: '/ui/',
      RESERVED_BASE_PATH_PREFIXES: settings.reservedPrefixes,
    };
  },
}));

const API = '/pulp/api/v3';

beforeEach(() => {
  settings.reservedPrefixes = [];
  server.use(
    listOf(`${API}/remotes/file/file/`, []).handler,
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
}: {
  isNew: boolean;
  onSave: Save;
  errorMessages?: Record<string, string>;
  initial?: Record<string, unknown>;
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
      plugin='file'
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
    const { user } = renderWithProviders(<Harness isNew onSave={onSave} />);

    await user.click(await screen.findByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenLastCalledWith({ distribution: null });

    await user.click(distributionBox());
    await user.type(basePathInput(), 'tools/stable');
    await user.click(saveButton());

    expect(onSave).toHaveBeenLastCalledWith({
      distribution: { basePath: 'tools/stable' },
    });
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

describe('repository form, reserved base paths', () => {
  async function tickAndType(path: string) {
    const rendered = renderWithProviders(<Harness isNew onSave={vi.fn()} />);
    await rendered.user.click(
      await screen.findByRole('checkbox', { name: /Create a distribution/ }),
    );
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
    const { user } = renderWithProviders(<Harness isNew onSave={onSave} />);

    await screen.findByRole('button', { name: 'Save' });
    await user.dblClick(saveButton());

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(saveButton()).toBeDisabled();

    await act(async () => finish());
    await waitFor(() => expect(saveButton()).toBeEnabled());
  });

  it('calls the save handler once when the second click arrives before the page has re-rendered', async () => {
    const { onSave } = pendingSave();
    renderWithProviders(<Harness isNew onSave={onSave} />);

    const button = await screen.findByRole('button', { name: 'Save' });
    act(() => {
      button.click();
      button.click();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
