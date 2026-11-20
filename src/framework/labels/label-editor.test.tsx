import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import { fileRepository } from 'src/entities/file/repository';
import { resetSessionEvents, setSignedIn } from 'src/session/session-events';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import {
  distributionListHandler,
  listOf,
  pluginListHandler,
  pluginRepository,
  projectedBy,
  publicationListHandler,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { PLUGIN_MANIFESTS, type PluginManifest } from '../manifest';
import { frameworkRoutes } from '../routes';
import { LabelEditor } from './label-editor';

const API = '/pulp/api/v3';

const FILE: PluginManifest = {
  ...(PLUGIN_MANIFESTS.find(
    ({ plugin }) => plugin === 'file',
  ) as PluginManifest),
  onFramework: true,
};

type Repository = ReturnType<typeof pluginRepository>;

interface Sent {
  method: string;
  path: string;
  body: unknown;
}

// Every label request the code sends, with its body, and the repository the
// server holds: a set label changes it as the server does.
let sent: Sent[];
let held: Repository;

beforeEach(() => {
  sent = [];
  held = pluginRepository('file', {
    name: 'tools',
    pulp_labels: { team: 'docs', tier: null },
  });
});

afterEach(() => {
  resetSessionEvents();
});

function serveLabels(
  answer: (
    kind: 'set' | 'unset',
  ) => Response | Promise<Response> | undefined = () => undefined,
) {
  server.use(
    http.post(
      `*${API}/repositories/file/file/:id/set_label/`,
      async ({ request }) => {
        const body = (await request.json()) as {
          key: string;
          value: string | null;
        };
        sent.push({
          method: 'POST',
          path: new URL(request.url).pathname,
          body,
        });
        const refusal = await answer('set');
        if (refusal) {
          return refusal;
        }
        held.pulp_labels = { ...held.pulp_labels, [body.key]: body.value };
        return HttpResponse.json(body);
      },
    ),
    http.post(
      `*${API}/repositories/file/file/:id/unset_label/`,
      async ({ request }) => {
        const body = (await request.json()) as { key: string };
        sent.push({
          method: 'POST',
          path: new URL(request.url).pathname,
          body,
        });
        const refusal = await answer('unset');
        if (refusal) {
          return refusal;
        }
        const { [body.key]: _gone, ...rest } = held.pulp_labels as Record<
          string,
          string | null
        >;
        held.pulp_labels = rest;
        return HttpResponse.json({ key: body.key, value: _gone });
      },
    ),
  );
}

function renderEditor(canEdit = true) {
  return renderWithProviders(
    <LabelEditor object={held} entity={fileRepository} canEdit={canEdit} />,
  );
}

const keyInput = () => screen.getByRole('textbox', { name: 'Label key' });
const valueInput = () => screen.getByRole('textbox', { name: 'Label value' });
const addButton = () => screen.getByRole('button', { name: 'Add label' });
const openEditor = async (user: ReturnType<typeof renderEditor>['user']) =>
  user.click(await screen.findByRole('button', { name: 'Edit labels' }));

describe('Integration: the label editor', { tags: ['integration'] }, () => {
  it('shows the labels as chips and no way to change them to a user who may not change the repository', () => {
    serveLabels();

    renderEditor(false);

    expect(screen.getByText('team: docs')).toBeVisible();
    expect(screen.getByText('tier')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Edit labels' })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('shows None for an object without labels, and still offers to add one', async () => {
    held = pluginRepository('file', { name: 'tools', pulp_labels: {} });
    serveLabels();

    const { user } = renderEditor();

    expect(screen.getByText('None')).toBeVisible();
    await openEditor(user);
    expect(keyInput()).toBeVisible();
  });

  it('opens an editor that lists the labels with a way to remove each, and sends nothing by opening', async () => {
    serveLabels();
    const { user } = renderEditor();

    await openEditor(user);

    expect(screen.getByText('team: docs')).toBeVisible();
    expect(
      screen.getByRole('button', { name: /Remove label team/ }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: /Remove label tier/ }),
    ).toBeVisible();
    expect(keyInput()).toHaveValue('');
    expect(sent).toStrictEqual([]);
  });

  it('sends one set_label with the key and the value for a new label, and clears the fields', async () => {
    serveLabels();
    const { user } = renderEditor();
    await openEditor(user);

    await user.type(keyInput(), 'app.example-name');
    await user.type(valueInput(), 'web');
    await user.click(addButton());

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].path).toMatch(
      /\/repositories\/file\/file\/[^/]+\/set_label\/$/,
    );
    expect(sent[0].body).toStrictEqual({
      key: 'app.example-name',
      value: 'web',
    });
    await waitFor(() => expect(keyInput()).toHaveValue(''));
    expect(valueInput()).toHaveValue('');
  });

  it('sends a null value for a label with no value', async () => {
    serveLabels();
    const { user } = renderEditor();
    await openEditor(user);

    await user.type(keyInput(), 'flagged');
    await user.click(addButton());

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body).toStrictEqual({ key: 'flagged', value: null });
  });

  it('changes the value of a label with one set_label when its key is typed again', async () => {
    serveLabels();
    const { user } = renderEditor();
    await openEditor(user);

    await user.click(screen.getByText('team: docs'));
    expect(keyInput()).toHaveValue('team');
    expect(valueInput()).toHaveValue('docs');
    await user.clear(valueInput());
    await user.type(valueInput(), 'ops');
    await user.click(addButton());

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body).toStrictEqual({ key: 'team', value: 'ops' });
  });

  it('sends one unset_label with the key when a label is removed', async () => {
    serveLabels();
    const { user } = renderEditor();
    await openEditor(user);

    await user.click(screen.getByRole('button', { name: /Remove label tier/ }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].path).toMatch(
      /\/repositories\/file\/file\/[^/]+\/unset_label\/$/,
    );
    expect(sent[0].body).toStrictEqual({ key: 'tier' });
  });

  it('shows the rule and sends nothing for a key the server would refuse', async () => {
    serveLabels();
    const { user } = renderEditor();
    await openEditor(user);

    await user.type(keyInput(), 'bad/key');

    expect(
      screen.getByText(
        'A label key can contain only letters, digits, underscores, spaces, dots and hyphens.',
      ),
    ).toBeVisible();
    expect(addButton()).toBeDisabled();
    await user.click(addButton());
    expect(sent).toStrictEqual([]);
  });

  it('shows the rule and sends nothing for a value with a parenthesis', async () => {
    serveLabels();
    const { user } = renderEditor();
    await openEditor(user);

    await user.type(keyInput(), 'ok');
    await user.type(valueInput(), 'a (b)');

    expect(
      screen.getByText('A label value cannot contain parentheses.'),
    ).toBeVisible();
    expect(addButton()).toBeDisabled();
    await user.click(addButton());
    expect(sent).toStrictEqual([]);
  });

  it('accepts a key with dots and hyphens and a value with a comma, as the server does', async () => {
    serveLabels();
    const { user } = renderEditor();
    await openEditor(user);

    await user.type(keyInput(), 'app.kubernetes.io-name');
    await user.type(valueInput(), 'a,b');

    expect(addButton()).toBeEnabled();
    await user.click(addButton());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body).toStrictEqual({
      key: 'app.kubernetes.io-name',
      value: 'a,b',
    });
  });

  it('asks for a key before it adds anything', async () => {
    serveLabels();
    const { user } = renderEditor();
    await openEditor(user);

    expect(addButton()).toBeDisabled();
    await user.type(valueInput(), 'orphan');
    expect(addButton()).toBeDisabled();
    expect(sent).toStrictEqual([]);
  });

  it('sends one request however often Add is pressed while the request is pending', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    serveLabels(async () => {
      await gate;
      return undefined;
    });
    const { user } = renderEditor();
    await openEditor(user);
    await user.type(keyInput(), 'once');

    await user.click(addButton());
    await user.click(addButton());
    await user.click(addButton());

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(addButton()).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /Remove label team/ }),
    ).toBeDisabled();

    await act(async () => release());
    await waitFor(() => expect(addButton()).toBeDisabled());
    expect(sent).toHaveLength(1);
  });

  it('shows the three-part refusal, keeps the editor open and keeps what was typed when the server refuses', async () => {
    serveLabels(() =>
      HttpResponse.json({ detail: 'Not for you.' }, { status: 403 }),
    );
    const { user } = renderEditor();
    await openEditor(user);
    await user.type(keyInput(), 'mine');
    await user.type(valueInput(), 'v');

    await user.click(addButton());

    expect(
      await screen.findByText('You do not have permission to do this.'),
    ).toBeVisible();
    expect(screen.getByText('Not for you.')).toBeVisible();
    expect(
      screen.getByText(
        'Contact your organization administrator for more information.',
      ),
    ).toBeVisible();
    expect(keyInput()).toHaveValue('mine');
    expect(valueInput()).toHaveValue('v');
    expect(sent).toHaveLength(1);
  });

  it('shows the refusal of a removal and keeps the label on screen', async () => {
    serveLabels(() =>
      HttpResponse.json({ detail: 'Not for you.' }, { status: 403 }),
    );
    const { user } = renderEditor();
    await openEditor(user);

    await user.click(screen.getByRole('button', { name: /Remove label tier/ }));

    expect(await screen.findByText('Not for you.')).toBeVisible();
    expect(screen.getByText('tier')).toBeVisible();
  });

  it('shows the message of the server for a field under that field and keeps the values', async () => {
    serveLabels(() =>
      HttpResponse.json({ key: ['Label keys are limited.'] }, { status: 400 }),
    );
    const { user } = renderEditor();
    await openEditor(user);
    await user.type(keyInput(), 'odd');

    await user.click(addButton());

    expect(await screen.findByText('Label keys are limited.')).toBeVisible();
    expect(keyInput()).toHaveValue('odd');
  });

  it('says nothing and keeps the values when the session ends', async () => {
    setSignedIn(true);
    let ended = true;
    serveLabels(() => HttpResponse.json({ detail: 'No.' }, { status: 401 }));
    const { user } = renderEditor();
    await openEditor(user);
    await user.type(keyInput(), 'later');

    await user.click(addButton());
    await waitFor(() => expect(sent).toHaveLength(1));

    expect(screen.queryByText('No.')).toBeNull();
    expect(keyInput()).toHaveValue('later');
    ended = false;
  });

  it('closes the editor with Done and shows the chips again', async () => {
    serveLabels();
    const { user } = renderEditor();
    await openEditor(user);

    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit labels' })).toBeVisible();
    expect(screen.getByText('team: docs')).toBeVisible();
  });
});

function Routed() {
  const { pathname } = useLocation();

  return (
    <>
      <p data-testid='location'>{pathname}</p>
      {useRoutes(guardRoutes(frameworkRoutes([FILE])))}
    </>
  );
}

describe(
  'Integration: the labels row of the repository detail',
  { tags: ['integration'] },
  () => {
    let permissions: { stop: () => void };

    beforeEach(() => {
      permissions = servePermissions({ id: 7, isStaff: true });
    });
    afterEach(() => permissions.stop());

    function serveDetail() {
      server.use(
        pluginListHandler('file', 'repository', [held]).handler,
        distributionListHandler('file', []).handler,
        publicationListHandler('file', []).handler,
        listOf(`${API}/remotes/`, [], {
          pageSize: 1000,
          projected: projectedBy,
        }).handler,
      );
      serveLabels();
    }

    const renderDetail = () =>
      renderWithProviders(
        <AppContextProvider>
          <PermissionsKnown>
            <Routed />
          </PermissionsKnown>
        </AppContextProvider>,
        { route: '/file/repositories/tools/' },
      );

    const labelsRow = async () => {
      const term = await screen.findByText('Labels', { selector: 'dt *, dt' });
      return term.closest('div') as HTMLElement;
    };

    it('shows the server labels in the row once a label was added, and once one was removed', async () => {
      serveDetail();
      const { user } = renderDetail();

      await user.click(
        await screen.findByRole('button', { name: 'Edit labels' }),
      );
      await user.type(keyInput(), 'app.example-name');
      await user.type(valueInput(), 'web');
      await user.click(addButton());

      expect(await screen.findByText('app.example-name: web')).toBeVisible();
      expect(sent).toHaveLength(1);

      await user.click(
        screen.getByRole('button', { name: /Remove label tier/ }),
      );
      await waitFor(() => expect(screen.queryByText('tier')).toBeNull());
      expect(sent).toHaveLength(2);
      expect(within(await labelsRow()).getByText('team: docs')).toBeVisible();
    });

    it('offers no editor to a user who holds no change permission', async () => {
      serveDetail();
      permissions.stop();
      permissions = servePermissions({ id: 7, isStaff: false, own: [] });
      server.use(listOf(`${API}/roles/`, [], { pageSize: 1000 }).handler);

      renderDetail();

      expect(await screen.findByText('team: docs')).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Edit labels' })).toBeNull();
    });
  },
);
