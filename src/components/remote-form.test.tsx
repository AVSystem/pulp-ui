import { screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { remote as remoteBuilder } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { RemoteForm } from './remote-form';

type Plugin = 'ansible' | 'container' | 'deb' | 'file' | 'python' | 'rpm';

// The form is controlled, so a small parent keeps the remote the way the edit
// pages do and hands the latest value to onSave.
function Harness({
  plugin,
  initial = {},
  onSave,
}: {
  plugin: Plugin;
  initial?: Record<string, unknown>;
  onSave: (remote: Record<string, unknown>) => void;
}) {
  const [remote, setRemote] = useState({
    ...remoteBuilder({ name: 'tools', policy: 'on_demand' }),
    ...(plugin === 'deb' ? { distributions: 'stable' } : {}),
    ...(plugin === 'ansible'
      ? {
          hidden_fields: [
            'client_key',
            'proxy_username',
            'proxy_password',
            'username',
            'password',
            'token',
          ].map((name) => ({ name, is_set: false })),
        }
      : {}),
    ...initial,
  });

  return (
    <AppContextProvider>
      <RemoteForm
        allowEditName
        closeModal={() => undefined}
        errorMessages={{}}
        plugin={plugin}
        remote={remote as never}
        saveRemote={() => onSave(remote)}
        showMain
        updateRemote={setRemote as never}
      />
    </AppContextProvider>
  );
}

const policySelect = () =>
  screen.queryByRole('combobox', { name: /Download policy/ });

const saveButton = () => screen.getByRole('button', { name: 'Save' });

describe('remote form, download policy', () => {
  it('offers immediate, on demand and streamed for a file remote and explains how they differ', async () => {
    renderWithProviders(<Harness plugin='file' onSave={vi.fn()} />);

    const select = await screen.findByRole('combobox', {
      name: /Download policy/,
    });
    const options = within(select)
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value);
    expect(options).toEqual(['immediate', 'on_demand', 'streamed']);
    expect(select).toHaveValue('on_demand');
    expect(
      screen.getByText(/On demand fetches content when a client asks for it/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Immediate downloads everything at sync/),
    ).toBeInTheDocument();
  });

  it('keeps the policy stored on the server when a file remote is opened for edit', async () => {
    const onSave = vi.fn();
    const { user } = renderWithProviders(
      <Harness
        plugin='file'
        initial={{ policy: 'immediate' }}
        onSave={onSave}
      />,
    );

    expect(
      await screen.findByRole('combobox', { name: /Download policy/ }),
    ).toHaveValue('immediate');
    await user.click(saveButton());

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ policy: 'immediate' }),
    );
  });

  it('sends the policy the user picks', async () => {
    const onSave = vi.fn();
    const { user } = renderWithProviders(
      <Harness plugin='file' onSave={onSave} />,
    );

    await user.selectOptions(
      await screen.findByRole('combobox', { name: /Download policy/ }),
      'streamed',
    );
    await user.click(saveButton());

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ policy: 'streamed' }),
    );
  });

  it.each(['python', 'rpm'] as const)(
    'offers the download policy for a %s remote',
    async (plugin) => {
      renderWithProviders(<Harness plugin={plugin} onSave={vi.fn()} />);

      expect(
        await screen.findByRole('combobox', { name: /Download policy/ }),
      ).toBeInTheDocument();
    },
  );

  it.each(['ansible', 'container'] as const)(
    'offers no download policy for a %s remote',
    async (plugin) => {
      renderWithProviders(<Harness plugin={plugin} onSave={vi.fn()} />);

      await screen.findByRole('textbox', { name: /Name/ });
      expect(policySelect()).toBeNull();
    },
  );
});
