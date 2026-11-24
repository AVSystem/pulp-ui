import {
  getPublicationsDebAptListUrl,
  publicationsDebAptCreate,
  publicationsDebAptList,
} from '@pulp-ui/sdk/deb/publications-apt';
import {
  makePublicationEntity,
  publicationSchema,
} from 'src/entities/plugin/publication';

// The deb plugin's publications, as far as the screens read them: which
// repository and version each one was made from.
export const debPublication = makePublicationEntity({
  app: 'deb',
  schema: publicationSchema,
  api: {
    create: publicationsDebAptCreate,
    list: publicationsDebAptList,
    listUrl: getPublicationsDebAptListUrl,
  },
});
