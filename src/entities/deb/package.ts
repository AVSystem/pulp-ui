import {
  contentDebPackagesList,
  getContentDebPackagesListUrl,
} from '@pulp-ui/sdk/deb/content-packages';
import { makeContentEntity } from 'src/entities/plugin/content';
import { debPackageSchema } from './model';

// The deb packages of a repository version, which the version page lists: the
// generated list function and the schema are all that differs from any other
// content type.
export const debPackage = makeContentEntity({
  app: 'deb',
  object: 'package',
  schema: debPackageSchema,
  textFilters: ['package__contains', 'architecture'],
  api: {
    list: contentDebPackagesList,
    listUrl: getContentDebPackagesListUrl,
  },
});
