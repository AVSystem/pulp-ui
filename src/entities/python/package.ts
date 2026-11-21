import {
  contentPythonPackagesList,
  getContentPythonPackagesListUrl,
} from '@pulp-ui/sdk/python/content-packages';
import { makeContentEntity } from 'src/entities/plugin/content';
import { pythonPackageSchema } from './model';

// The python packages of a repository version, which the Packages tab lists:
// the generated list function and the schema are all that differs from any
// other content type.
export const pythonPackage = makeContentEntity({
  app: 'python',
  object: 'package',
  schema: pythonPackageSchema,
  textFilters: ['name__contains', 'packagetype', 'requires_python__contains'],
  api: {
    list: contentPythonPackagesList,
    listUrl: getContentPythonPackagesListUrl,
  },
});
