import { contentList, getContentListUrl } from '@pulp-ui/sdk/core/content';
import { z } from 'zod';
import { makeContentEntity } from 'src/entities/plugin/content';

// One unit of content of any type, as far as a list of a type no plugin
// descriptor declares can show it: where it is and when the server first saw
// it. Labels are read with it for the screens that show them.
const coreContentSchema = z.looseObject({
  pulp_href: z.string(),
  pulp_created: z.string().nullish(),
  pulp_labels: z.record(z.string(), z.string().nullable()).nullish(),
});

export type CoreContent = z.infer<typeof coreContentSchema>;

// The content of every plugin through the one endpoint that lists it all. A
// list names the type it wants with `pulp_type`, and is cut to a repository
// version, to what a version added or to what it removed like the lists of the
// plugins. The server orders this list by its key only.
export const coreContent = makeContentEntity({
  app: 'core',
  object: 'content',
  schema: coreContentSchema,
  textFilters: ['pulp_type'],
  api: {
    list: contentList,
    listUrl: getContentListUrl,
  },
});
