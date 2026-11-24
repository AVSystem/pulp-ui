import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import debDescriptor from 'src/descriptors/deb/descriptor';
import fileDescriptor from 'src/descriptors/file/descriptor';
import pythonDescriptor from 'src/descriptors/python/descriptor';
import rpmDescriptor from 'src/descriptors/rpm/descriptor';
import { fileRepository } from 'src/entities/file/repository';
import { entityKeys } from 'src/entities/plugin/queries';
import { resetSessionEvents } from 'src/session/session-events';
import {
  type IPermissionSetup,
  PermissionsKnown,
  servePermissions,
} from 'src/test-utils/permissions';
import { pluginRepository, uploadLab } from 'src/test-utils/pulp';
import { createTestQueryClient } from 'src/test-utils/query';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import type { PluginDescriptor } from '../descriptor';
import { WatchedTasksProvider } from '../watched-tasks';
import { UploadDialog } from './upload-dialog';

// The upload dialog of a repository as a user meets it: files are chosen,
// each gets a relative path, the dialog says how many repository versions the
// upload makes, shows the progress of every file and then what became of it.
// The server is the upload lab: it records everything it was sent and starts a
// task for every content create.

const MIB = 1024 * 1024;

const ADMIN: IPermissionSetup = { id: 7, isStaff: true };
// A user who may modify the repository and create uploads, and is no
// administrator.
const EDITOR: IPermissionSetup = {
  id: 8,
  isStaff: false,
  own: [['file.modify_filerepository', 'core.add_upload']],
};
// A user who may modify the repository and may not create uploads.
const WRITER: IPermissionSetup = {
  id: 9,
  isStaff: false,
  own: [['file.modify_filerepository']],
};

type Plugin = 'file' | 'deb' | 'rpm' | 'python';

const DESCRIPTORS: Record<Plugin, PluginDescriptor> = {
  file: fileDescriptor as PluginDescriptor,
  deb: debDescriptor as PluginDescriptor,
  rpm: rpmDescriptor as PluginDescriptor,
  python: pythonDescriptor as PluginDescriptor,
};

// Where each plugin's server takes content creates.
const CONTENT_PATH: Record<Plugin, string> = {
  file: '/pulp/api/v3/content/file/files/',
  deb: '/pulp/api/v3/content/deb/packages/',
  rpm: '/pulp/api/v3/content/rpm/packages/',
  python: '/pulp/api/v3/content/python/packages/',
};

let permissions: { stop: () => void };

beforeEach(() => {
  permissions = servePermissions(ADMIN);
});

afterEach(() => {
  permissions.stop();
  resetSessionEvents();
});

const fileOf = (name: string, bytes = 10) =>
  new File([new Uint8Array(bytes)], name);

interface Setup {
  plugin?: Plugin;
  user?: IPermissionSetup;
  retain?: number | null;
}

function render({ plugin = 'file', user = ADMIN, retain = null }: Setup = {}) {
  permissions.stop();
  permissions = servePermissions(user);

  const repository = pluginRepository(plugin, {
    name: 'tools',
    retain_repo_versions: retain,
  });
  const onClose = vi.fn();
  const queryClient = createTestQueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const descriptor = DESCRIPTORS[plugin];
  const types = descriptor.contentTypes ?? [];
  const upload = descriptor.repository?.upload;
  if (!descriptor.repository || !upload) {
    throw new Error(`The ${plugin} descriptor declares no upload`);
  }

  const rendered = renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <WatchedTasksProvider>
          <UploadDialog
            repository={repository}
            entity={descriptor.repository.entity}
            types={types}
            upload={upload}
            onClose={onClose}
          />
        </WatchedTasksProvider>
      </PermissionsKnown>
    </AppContextProvider>,
    { signedIn: true, queryClient },
  );

  return { ...rendered, repository, onClose, invalidate };
}

type Rendered = ReturnType<typeof render>;

async function choose(user: Rendered['user'], ...files: File[]) {
  const dialog = await screen.findByRole('dialog');
  const input = dialog.querySelector('input[type="file"]');
  if (!input) {
    throw new Error('The dialog has no file input');
  }
  await user.upload(input as HTMLInputElement, files);
  return dialog;
}

// The row that shows the text; a file whose path is its name shows it twice.
const rowOf = (dialog: HTMLElement, name: string) =>
  within(dialog)
    .getAllByRole('row')
    .find(
      (candidate) => within(candidate).queryAllByText(name).length > 0,
    ) as HTMLElement;

const upload = (dialog: HTMLElement) =>
  within(dialog).getByRole('button', { name: 'Upload' });

describe(
  'Integration: uploading files into a repository',
  { tags: ['integration'] },
  () => {
    it('lists the chosen files with a relative path each, which is the file name until the user types another', async () => {
      const { user } = render();
      const dialog = await choose(user, fileOf('a.txt'), fileOf('b.txt'));

      const first = within(dialog).getByRole('textbox', {
        name: 'Relative path of a.txt',
      });
      expect(first).toHaveValue('a.txt');
      expect(
        within(dialog).getByRole('textbox', {
          name: 'Relative path of b.txt',
        }),
      ).toHaveValue('b.txt');
      expect(upload(dialog)).toBeEnabled();

      await user.clear(first);
      await user.type(first, 'docs/a.txt');
      expect(first).toHaveValue('docs/a.txt');
    });

    it('offers nothing to upload before a file is chosen', async () => {
      render();

      const dialog = await screen.findByRole('dialog');

      expect(upload(dialog)).toBeDisabled();
    });

    it('blocks the upload with a message at the field when a path is empty', async () => {
      const lab = uploadLab();
      server.use(...lab.handlers);
      const { user } = render();
      const dialog = await choose(user, fileOf('a.txt'));

      await user.clear(
        within(dialog).getByRole('textbox', {
          name: 'Relative path of a.txt',
        }),
      );

      expect(
        await within(dialog).findByText('Enter a relative path.'),
      ).toBeVisible();
      expect(upload(dialog)).toBeDisabled();
      expect(lab.creates).toHaveLength(0);
    });

    it('blocks the upload with a message at the field when a path starts with a slash', async () => {
      const lab = uploadLab();
      server.use(...lab.handlers);
      const { user } = render();
      const dialog = await choose(user, fileOf('a.txt'));
      const field = within(dialog).getByRole('textbox', {
        name: 'Relative path of a.txt',
      });

      await user.clear(field);
      await user.type(field, '/etc/a.txt');

      expect(
        await within(dialog).findByText(
          'The path must not start with a slash.',
        ),
      ).toBeVisible();
      expect(upload(dialog)).toBeDisabled();

      await user.clear(field);
      await user.type(field, 'etc/a.txt');
      expect(upload(dialog)).toBeEnabled();
      expect(lab.creates).toHaveLength(0);
    });

    it('leaves every other path, a parent segment included, to the server', async () => {
      const lab = uploadLab({
        refuseCreate: ({ fields }) =>
          fields['relative_path']?.includes('..')
            ? 'Relative path cannot contain a parent directory segment.'
            : undefined,
      });
      server.use(...lab.handlers);
      const { user } = render({ user: EDITOR });
      const dialog = await choose(user, fileOf('a.txt'));
      const field = within(dialog).getByRole('textbox', {
        name: 'Relative path of a.txt',
      });
      await user.clear(field);
      await user.type(field, 'x/../a.txt');

      expect(upload(dialog)).toBeEnabled();
      await user.click(upload(dialog));

      expect(
        await within(rowOf(dialog, 'x/../a.txt')).findByText(
          'Relative path cannot contain a parent directory segment.',
        ),
      ).toBeVisible();
    });

    it('removes a file from the list before the upload', async () => {
      const { user } = render();
      const dialog = await choose(user, fileOf('a.txt'), fileOf('b.txt'));

      await user.click(
        within(dialog).getByRole('button', { name: 'Remove a.txt' }),
      );

      expect(
        within(dialog).queryByRole('textbox', {
          name: 'Relative path of a.txt',
        }),
      ).toBeNull();
      expect(
        within(dialog).getByRole('textbox', { name: 'Relative path of b.txt' }),
      ).toBeVisible();
    });

    describe('what the upload makes of the repository', () => {
      it('tells a user who is not an administrator that every file makes a version of its own', async () => {
        const { user } = render({ user: EDITOR });
        const dialog = await choose(user, fileOf('a.txt'), fileOf('b.txt'));

        expect(
          within(dialog).getByText(
            'Each file creates its own repository version',
          ),
        ).toBeVisible();
        expect(
          within(dialog).queryByText(
            'All files are added in one new repository version',
          ),
        ).toBeNull();
      });

      it('warns before the upload that older versions are pushed out when the repository keeps a limited number', async () => {
        const { user } = render({ user: EDITOR, retain: 3 });
        const dialog = await choose(user, fileOf('a.txt'), fileOf('b.txt'));

        expect(
          within(dialog).getByText('Older versions may be removed'),
        ).toBeVisible();
        expect(
          within(dialog).getByText(/keeps only its latest 3 versions/),
        ).toBeVisible();
      });

      it('does not warn about retention when the repository keeps every version', async () => {
        const { user } = render({ user: EDITOR, retain: null });
        const dialog = await choose(user, fileOf('a.txt'));

        expect(
          within(dialog).queryByText('Older versions may be removed'),
        ).toBeNull();
      });

      it('tells an administrator that all files are added in one new version', async () => {
        const { user } = render({ retain: 3 });
        const dialog = await choose(user, fileOf('a.txt'), fileOf('b.txt'));

        expect(
          within(dialog).getByText(
            'All files are added in one new repository version',
          ),
        ).toBeVisible();
        expect(
          within(dialog).queryByText(
            'Each file creates its own repository version',
          ),
        ).toBeNull();
      });
    });

    describe('the upload of a user who is not an administrator', () => {
      it('creates every file with the repository and shows each as added', async () => {
        const lab = uploadLab();
        server.use(...lab.handlers);
        const { user, repository } = render({ user: EDITOR });
        const dialog = await choose(user, fileOf('a.txt'), fileOf('b.txt'));

        await user.click(upload(dialog));

        expect(
          await within(rowOf(dialog, 'a.txt')).findByText('Added'),
        ).toBeVisible();
        expect(
          await within(rowOf(dialog, 'b.txt')).findByText('Added'),
        ).toBeVisible();
        expect(lab.creates.map(({ fields }) => fields)).toStrictEqual(
          expect.arrayContaining([
            { relative_path: 'a.txt', repository: repository.pulp_href },
            { relative_path: 'b.txt', repository: repository.pulp_href },
          ]),
        );
        expect(lab.modifies).toHaveLength(0);
        expect(
          within(dialog).getByRole('button', { name: 'Done' }),
        ).toBeVisible();
      });

      it('shows a file whose task failed with the server reason and the others as added', async () => {
        const lab = uploadLab({
          failTask: ({ fields }) =>
            fields['relative_path'] === 'b.txt'
              ? 'A file with this path is already in a newer version.'
              : undefined,
        });
        server.use(...lab.handlers);
        const { user } = render({ user: EDITOR });
        const dialog = await choose(user, fileOf('a.txt'), fileOf('b.txt'));

        await user.click(upload(dialog));

        expect(
          await within(rowOf(dialog, 'a.txt')).findByText('Added'),
        ).toBeVisible();
        const failed = rowOf(dialog, 'b.txt');
        expect(await within(failed).findByText('Failed')).toBeVisible();
        expect(
          within(failed).getByText(
            'A file with this path is already in a newer version.',
          ),
        ).toBeVisible();
      });

      it('shows a file the server refused with its reason', async () => {
        const lab = uploadLab({
          refuseCreate: () => 'Destination upload repository was not found.',
        });
        server.use(...lab.handlers);
        const { user } = render({ user: EDITOR });
        const dialog = await choose(user, fileOf('a.txt'));

        await user.click(upload(dialog));

        const failed = rowOf(dialog, 'a.txt');
        expect(await within(failed).findByText('Failed')).toBeVisible();
        expect(
          within(failed).getByText(
            'Destination upload repository was not found.',
          ),
        ).toBeVisible();
      });

      it('reads the repository again when the files are added, so the Content tab shows the new version', async () => {
        const lab = uploadLab();
        server.use(...lab.handlers);
        const { user, invalidate } = render({ user: EDITOR });
        const dialog = await choose(user, fileOf('a.txt'));

        await user.click(upload(dialog));
        await within(rowOf(dialog, 'a.txt')).findByText('Added');

        await waitFor(() =>
          expect(invalidate).toHaveBeenCalledWith(
            expect.objectContaining({
              queryKey: entityKeys(fileRepository).all,
            }),
          ),
        );
      });
    });

    describe('the upload of an administrator', () => {
      it('adds all files in one request and shows each as added', async () => {
        const lab = uploadLab();
        server.use(...lab.handlers);
        const { user, repository } = render();
        const dialog = await choose(user, fileOf('a.txt'), fileOf('b.txt'));

        await user.click(upload(dialog));

        expect(
          await within(rowOf(dialog, 'a.txt')).findByText('Added'),
        ).toBeVisible();
        expect(within(rowOf(dialog, 'b.txt')).getByText('Added')).toBeVisible();
        expect(lab.modifies).toHaveLength(1);
        expect(lab.modifies[0]?.href).toBe(`${repository.pulp_href}modify/`);
        expect(lab.modifies[0]?.body).toStrictEqual({
          add_content_units: expect.arrayContaining(lab.contentHrefs),
        });
        expect(lab.creates.every(({ fields }) => !fields['repository'])).toBe(
          true,
        );
      });

      it('shows the failing file with its reason and says that nothing was added', async () => {
        const lab = uploadLab({
          refuseCreate: ({ fields }) =>
            fields['relative_path'] === 'b.txt'
              ? 'Relative path cannot contain a parent directory segment.'
              : undefined,
        });
        server.use(...lab.handlers);
        const { user } = render();
        const dialog = await choose(user, fileOf('a.txt'), fileOf('b.txt'));

        await user.click(upload(dialog));

        const failed = rowOf(dialog, 'b.txt');
        expect(await within(failed).findByText('Failed')).toBeVisible();
        expect(
          within(failed).getByText(
            'Relative path cannot contain a parent directory segment.',
          ),
        ).toBeVisible();
        expect(
          await within(rowOf(dialog, 'a.txt')).findByText('Not added'),
        ).toBeVisible();
        expect(
          within(dialog).getByText(/Nothing was added to the repository/),
        ).toBeVisible();
        expect(lab.modifies).toHaveLength(0);
      });

      it('shows the server reason when the repository refuses the addition', async () => {
        const lab = uploadLab({ refuseModify: 'Content cannot be added.' });
        server.use(...lab.handlers);
        const { user } = render();
        const dialog = await choose(user, fileOf('a.txt'));

        await user.click(upload(dialog));

        const failed = rowOf(dialog, 'a.txt');
        expect(await within(failed).findByText('Failed')).toBeVisible();
        expect(
          within(failed).getByText('Content cannot be added.'),
        ).toBeVisible();
      });
    });

    describe('progress', () => {
      it('shows the progress of a file sent in chunks and no bar for a file sent in one request', async () => {
        const lab = uploadLab({ chunkMs: 150 });
        server.use(...lab.handlers);
        const { user } = render();
        const dialog = await choose(
          user,
          fileOf('big.bin', 20 * MIB),
          fileOf('small.txt'),
        );

        await user.click(upload(dialog));

        const bar = await within(rowOf(dialog, 'big.bin')).findByRole(
          'progressbar',
          { name: 'Upload of big.bin' },
        );
        expect(bar).toBeVisible();
        expect(
          within(rowOf(dialog, 'small.txt')).queryByRole('progressbar', {
            name: 'Upload of small.txt',
          }),
        ).toBeNull();

        await within(rowOf(dialog, 'big.bin')).findByText('Added', undefined, {
          timeout: 5000,
        });
        expect(lab.chunks.length).toBeGreaterThan(1);
      });
    });

    describe('closing the dialog', () => {
      it('closes at once when nothing is on its way', async () => {
        const { user, onClose } = render();
        await choose(user, fileOf('a.txt'));

        await user.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onClose).toHaveBeenCalledOnce();
      });

      it('asks whether to cancel during an upload, keeps uploading on no and aborts the request on yes', async () => {
        const lab = uploadLab({ createMs: 4000 });
        server.use(...lab.handlers);
        const { user, onClose } = render({ user: EDITOR });
        const dialog = await choose(user, fileOf('a.txt'), fileOf('b.txt'));
        await user.click(upload(dialog));
        await waitFor(() => expect(lab.creates.length).toBeGreaterThan(0));

        await user.click(
          within(dialog).getByRole('button', { name: 'Cancel upload' }),
        );

        expect(
          await within(dialog).findByText('Cancel the upload?'),
        ).toBeVisible();
        expect(onClose).not.toHaveBeenCalled();

        await user.click(
          within(dialog).getByRole('button', { name: 'Keep uploading' }),
        );
        expect(within(dialog).queryByText('Cancel the upload?')).toBeNull();

        await user.click(
          within(dialog).getByRole('button', { name: 'Cancel upload' }),
        );
        await user.click(
          await within(dialog).findByRole('button', {
            name: 'Stop uploading',
          }),
        );

        expect(
          await within(rowOf(dialog, 'a.txt')).findByText('Canceled'),
        ).toBeVisible();
        expect(
          within(rowOf(dialog, 'b.txt')).getByText('Canceled'),
        ).toBeVisible();
        expect(
          within(dialog).getByRole('button', { name: 'Done' }),
        ).toBeVisible();
        expect(onClose).not.toHaveBeenCalled();
      });

      it('treats the close button of the dialog during an upload as a request to cancel', async () => {
        const lab = uploadLab({ createMs: 4000 });
        server.use(...lab.handlers);
        const { user, onClose } = render({ user: EDITOR });
        const dialog = await choose(user, fileOf('a.txt'));
        await user.click(upload(dialog));
        await waitFor(() => expect(lab.creates.length).toBeGreaterThan(0));

        await user.click(within(dialog).getByRole('button', { name: 'Close' }));

        expect(
          await within(dialog).findByText('Cancel the upload?'),
        ).toBeVisible();
        expect(onClose).not.toHaveBeenCalled();
      });
    });

    describe('the plugins that upload besides file', () => {
      it.each(['deb', 'rpm'] as const)(
        'asks for no path for %s and sends none, the server finds it in the package',
        async (plugin) => {
          const lab = uploadLab({ contentPath: CONTENT_PATH[plugin] });
          server.use(...lab.handlers);
          const { user, repository } = render({ plugin, user: EDITOR });
          const dialog = await choose(user, fileOf('tool_1.0_all.pkg'));

          expect(within(dialog).queryByText('Relative path')).toBeNull();
          expect(within(dialog).queryByRole('textbox')).toBeNull();

          await user.click(upload(dialog));

          expect(
            await within(rowOf(dialog, 'tool_1.0_all.pkg')).findByText('Added'),
          ).toBeVisible();
          expect(lab.creates.map(({ fields }) => fields)).toStrictEqual([
            { repository: repository.pulp_href },
          ]);
        },
      );

      it('shows the file name as the fixed path for python and sends it', async () => {
        const lab = uploadLab({ contentPath: CONTENT_PATH.python });
        server.use(...lab.handlers);
        const { user, repository } = render({
          plugin: 'python',
          user: EDITOR,
        });
        const dialog = await choose(user, fileOf('tool-1.0.tar.gz'));

        expect(within(dialog).getByText('Relative path')).toBeVisible();
        expect(within(dialog).queryByRole('textbox')).toBeNull();
        expect(
          within(rowOf(dialog, 'tool-1.0.tar.gz')).getAllByText(
            'tool-1.0.tar.gz',
          ),
        ).toHaveLength(2);
        expect(upload(dialog)).toBeEnabled();

        await user.click(upload(dialog));

        expect(
          await within(rowOf(dialog, 'tool-1.0.tar.gz')).findByText('Added'),
        ).toBeVisible();
        expect(lab.creates.map(({ fields }) => fields)).toStrictEqual([
          {
            relative_path: 'tool-1.0.tar.gz',
            repository: repository.pulp_href,
          },
        ]);
      });

      it.each(['deb', 'rpm', 'python'] as const)(
        'says for %s that every file makes a version of its own when the user is no administrator',
        async (plugin) => {
          const { user } = render({ plugin, user: EDITOR });
          const dialog = await choose(user, fileOf('a.pkg'), fileOf('b.pkg'));

          expect(
            within(dialog).getByText(
              'Each file creates its own repository version',
            ),
          ).toBeVisible();
        },
      );

      it('adds the files of an administrator in one version for rpm as well', async () => {
        const lab = uploadLab({ contentPath: CONTENT_PATH.rpm });
        server.use(...lab.handlers);
        const { user, repository } = render({ plugin: 'rpm' });
        const dialog = await choose(user, fileOf('a.rpm'), fileOf('b.rpm'));

        await user.click(upload(dialog));

        expect(
          await within(rowOf(dialog, 'b.rpm')).findByText('Added'),
        ).toBeVisible();
        expect(lab.modifies).toHaveLength(1);
        expect(lab.modifies[0]?.href).toBe(`${repository.pulp_href}modify/`);
      });
    });

    describe('large files for a user who may not create uploads', () => {
      const NOTE = 'Large files are sent in one request and may time out';

      it('says before the upload that a file above the chunk threshold is sent in one request and may time out', async () => {
        const { user } = render({ user: WRITER });
        const dialog = await choose(user, fileOf('big.bin', 9 * MIB));

        expect(within(dialog).getByText(NOTE)).toBeVisible();
      });

      it('says nothing of it for small files', async () => {
        const { user } = render({ user: WRITER });
        const dialog = await choose(user, fileOf('small.bin', 8 * MIB));

        expect(within(dialog).queryByText(NOTE)).toBeNull();
      });

      it('says nothing of it to a user who may create uploads', async () => {
        const { user } = render({ user: EDITOR });
        const dialog = await choose(user, fileOf('big.bin', 9 * MIB));

        expect(within(dialog).queryByText(NOTE)).toBeNull();
      });

      it('says nothing of it to an administrator', async () => {
        const { user } = render();
        const dialog = await choose(user, fileOf('big.bin', 9 * MIB));

        expect(within(dialog).queryByText(NOTE)).toBeNull();
      });

      it('sends such a file in one request', async () => {
        const lab = uploadLab();
        server.use(...lab.handlers);
        const { user } = render({ user: WRITER });
        const dialog = await choose(user, fileOf('big.bin', 9 * MIB));

        await user.click(upload(dialog));
        await within(rowOf(dialog, 'big.bin')).findByText('Added');

        expect(lab.uploads).toHaveLength(0);
        expect(lab.creates[0]?.fileBytes).toBe(9 * MIB);
      });
    });
  },
);
