import {
  contentRpmPackagesCreate,
  contentRpmPackagesList,
  contentRpmPackagesSetLabel,
  contentRpmPackagesUnsetLabel,
  getContentRpmPackagesListUrl,
} from '@pulp-ui/sdk/rpm/content-packages';
import type { RpmPackage } from '@pulp-ui/sdk/rpm/models/content-packages/rpm-package.zod';
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
  // An rpm package carries its own path; one is sent only when the user gave it.
  upload: {
    create: (body, options) =>
      contentRpmPackagesCreate(body as RpmPackage, options),
    relativePath: 'given',
  },
});
