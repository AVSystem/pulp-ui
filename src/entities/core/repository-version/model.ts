import { z } from 'zod';
import { pulpHrefSchema } from 'src/entities/href';
import { pageSchemaOf } from 'src/entities/plugin/model';

// What a list of repositories reads of the latest version of each repository:
// its address and how much content it holds per content type. An unnamed field
// is kept as it came and the address is a same-origin path.
const contentCountSchema = z.looseObject({
  count: z.number().nullish(),
  href: z.string().nullish(),
});

const versionSummarySchema = z.looseObject({
  pulp_href: pulpHrefSchema,
  content_summary: z
    .looseObject({
      added: z.record(z.string(), contentCountSchema).nullish(),
      removed: z.record(z.string(), contentCountSchema).nullish(),
      present: z.record(z.string(), contentCountSchema).nullish(),
    })
    .nullish(),
});

const versionSummaryPageSchema = pageSchemaOf(versionSummarySchema);

type VersionSummary = z.infer<typeof versionSummarySchema>;

// How much content a version holds: the sum of the counts of the content that
// is present, over every content type. None when the answer carries no summary
// of the content present.
function contentCount(summary: VersionSummary): number | null {
  const present = summary.content_summary?.present;
  if (!present) {
    return null;
  }

  return Object.values(present).reduce(
    (total, entry) => total + (entry.count ?? 0),
    0,
  );
}

export { contentCount, versionSummaryPageSchema, versionSummarySchema };
export type { VersionSummary };
