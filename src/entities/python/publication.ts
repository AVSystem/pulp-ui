import {
  getPublicationsPythonPypiListUrl,
  publicationsPythonPypiList,
} from '@pulp-ui/sdk/python/publications-pypi';
import {
  makePublicationEntity,
  publicationSchema,
} from 'src/entities/plugin/publication';

// The python plugin's publications, as far as the screens read them: which
// repository and version each one was made from. Publications are deprecated
// there and python serves versions directly; a distribution can still be bound
// to one, and finding the repository it serves needs them read.
export const pythonPublication = makePublicationEntity({
  app: 'python',
  schema: publicationSchema,
  api: {
    list: publicationsPythonPypiList,
    listUrl: getPublicationsPythonPypiListUrl,
  },
});
