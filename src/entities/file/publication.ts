import {
  getPublicationsFileFileListUrl,
  publicationsFileFileList,
} from '@pulp-ui/sdk/file/publications-file';
import {
  makePublicationEntity,
  publicationSchema,
} from 'src/entities/plugin/publication';

// The file plugin's publications, as far as the screens read them: which
// repository and version each one was made from.
export const filePublication = makePublicationEntity({
  app: 'file',
  schema: publicationSchema,
  api: {
    list: publicationsFileFileList,
    listUrl: getPublicationsFileFileListUrl,
  },
});
