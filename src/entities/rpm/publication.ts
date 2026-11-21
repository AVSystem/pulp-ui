import {
  getPublicationsRpmRpmListUrl,
  publicationsRpmRpmList,
} from '@pulp-ui/sdk/rpm/publications-rpm';
import {
  makePublicationEntity,
  publicationSchema,
} from 'src/entities/plugin/publication';

// The rpm plugin's publications, as far as the screens read them: which
// repository and version each one was made from.
export const rpmPublication = makePublicationEntity({
  app: 'rpm',
  schema: publicationSchema,
  api: {
    list: publicationsRpmRpmList,
    listUrl: getPublicationsRpmRpmListUrl,
  },
});
