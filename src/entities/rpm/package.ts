import {
  contentRpmPackagesList,
  contentRpmPackagesSetLabel,
  contentRpmPackagesUnsetLabel,
  getContentRpmPackagesListUrl,
} from '@pulp-ui/sdk/rpm/content-packages';
import { makeContentEntity } from 'src/entities/plugin/content';
import { rpmPackageSchema } from './model';

// The rpm packages of a repository version, which the Packages tab lists: the
// generated list function and the schema are all that differs from any other
// content type.
export const rpmPackage = makeContentEntity({
  app: 'rpm',
  object: 'package',
  schema: rpmPackageSchema,
  textFilters: ['name__contains', 'arch', 'pulp_label_select'],
  api: {
    list: contentRpmPackagesList,
    listUrl: getContentRpmPackagesListUrl,
    setLabel: contentRpmPackagesSetLabel,
    unsetLabel: contentRpmPackagesUnsetLabel,
  },
});
