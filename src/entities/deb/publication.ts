import {
  getPublicationsDebAptListUrl,
  publicationsDebAptCreate,
  publicationsDebAptDelete,
  publicationsDebAptList,
} from '@pulp-ui/sdk/deb/publications-apt';
import { publicationsDebVerbatimDelete } from '@pulp-ui/sdk/deb/publications-verbatim';
import {
  makePublicationEntity,
  publicationSchema,
} from 'src/entities/plugin/publication';

// The deb plugin's publications, as far as the screens read them: which
// repository and version each one was made from. A deb repository has two kinds
// of publication, apt and verbatim, and the address says which a delete goes to.
const VERBATIM = /\/publications\/deb\/verbatim\//;

export const debPublication = makePublicationEntity({
  app: 'deb',
  schema: publicationSchema,
  api: {
    create: publicationsDebAptCreate,
    remove: (href, options) =>
      VERBATIM.test(href)
        ? publicationsDebVerbatimDelete(href, options)
        : publicationsDebAptDelete(href, options),
    list: publicationsDebAptList,
    listUrl: getPublicationsDebAptListUrl,
  },
});
