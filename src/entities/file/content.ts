import {
  contentFileFilesList,
  getContentFileFilesListUrl,
} from '@pulp-ui/sdk/file/content-files';
import { makeContentEntity } from 'src/entities/plugin/content';
import { fileContentSchema } from './model';

// The files of a repository version, which the version page lists: the
// generated list function and the schema are all that differs from any other
// content type.
export const fileContent = makeContentEntity({
  app: 'file',
  object: 'content',
  schema: fileContentSchema,
  textFilters: ['relative_path__contains'],
  api: {
    list: contentFileFilesList,
    listUrl: getContentFileFilesListUrl,
  },
});
