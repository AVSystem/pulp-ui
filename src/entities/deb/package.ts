import {
  contentDebPackagesCreate,
  contentDebPackagesList,
  contentDebPackagesSetLabel,
  contentDebPackagesUnsetLabel,
  getContentDebPackagesListUrl,
} from '@pulp-ui/sdk/deb/content-packages';
import type { DebPackage } from '@pulp-ui/sdk/deb/models/content-packages/deb-package.zod';
import { makeContentEntity } from 'src/entities/plugin/content';
import { debPackageSchema } from './model';

// The deb packages of a repository version, which the version page lists: the
// generated list function and the schema are all that differs from any other
// content type.
export const debPackage = makeContentEntity({
  app: 'deb',
  object: 'package',
  schema: debPackageSchema,
  textFilters: ['package__contains', 'architecture', 'pulp_label_select'],
  api: {
    list: contentDebPackagesList,
    listUrl: getContentDebPackagesListUrl,
    setLabel: contentDebPackagesSetLabel,
    unsetLabel: contentDebPackagesUnsetLabel,
  },
  // A deb package carries its own path; one is sent only when the user gave it.
  upload: {
    create: (body, options) =>
      contentDebPackagesCreate(body as DebPackage, options),
    relativePath: 'given',
  },
});
