import {
  contentFileFilesCreate,
  contentFileFilesList,
  contentFileFilesSetLabel,
  contentFileFilesUnsetLabel,
  getContentFileFilesListUrl,
} from '@pulp-ui/sdk/file/content-files';
import type { FileFileContent } from '@pulp-ui/sdk/file/models/content-files/file-file-content.zod';
import { makeContentEntity } from 'src/entities/plugin/content';
import { fileContentSchema } from './model';

// The files of a repository version, which the version page lists: the
// generated list function and the schema are all that differs from any other
// content type.
export const fileContent = makeContentEntity({
  app: 'file',
  object: 'content',
  schema: fileContentSchema,
  textFilters: ['relative_path__contains', 'pulp_label_select'],
  api: {
    list: contentFileFilesList,
    listUrl: getContentFileFilesListUrl,
    setLabel: contentFileFilesSetLabel,
    unsetLabel: contentFileFilesUnsetLabel,
  },
  // A file unit needs a path in the repository: the file's name unless the
  // user chose another.
  upload: {
    create: (body, options) =>
      contentFileFilesCreate(body as FileFileContent, options),
    relativePath: 'given-or-file-name',
  },
});
