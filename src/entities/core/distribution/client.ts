import { distributionsList } from '@pulp-ui/sdk/core/distributions';
import { z } from 'zod';
import { pulpHrefSchema } from 'src/entities/href';
import { pageSchemaOf } from 'src/entities/plugin/model';
import { parseResponse } from 'src/entities/response-shape';
import {
  basePathAncestors,
  isUnderBasePath,
} from 'src/utilities/base-path-rules';

// The distributions of every plugin through the one endpoint that lists them
// all. Names and base paths are unique across plugins, so a question about
// whether one is taken is asked here and never plugin by plugin.
//
// An answer names a distribution only by what a conflict message needs.
const distributionRefSchema = z.looseObject({
  pulp_href: pulpHrefSchema,
  name: z.string(),
  base_path: z.string(),
});

const refPageSchema = pageSchemaOf(distributionRefSchema);

export interface DistributionRef {
  name: string;
  base_path: string;
}

const FIELDS = ['name', 'base_path', 'pulp_href'];

// How many distributions one request reads while looking for nested paths: the
// most the server answers on one page.
const PAGE_SIZE = 1000;

const refOf = ({ name, base_path }: DistributionRef): DistributionRef => ({
  name,
  base_path,
});

// The distribution of any plugin that already has this exact name, or null.
async function existsByName(
  name: string,
  options?: RequestInit,
): Promise<DistributionRef | null> {
  const data = await distributionsList(
    { name, fields: FIELDS, limit: 1 },
    options,
  );
  const found = parseResponse(refPageSchema, data).results[0];

  // The name is unique, so a row of another name means the filter was not
  // applied; it is not a conflict.
  return found && found.name === name ? refOf(found) : null;
}

// The distribution whose base path is equal to, an ancestor of, or nested below
// the given one, or null. The server refuses all three, so the form can say so
// before anything is created. The nested-below filter matches anywhere in a
// path, so every page of it is read and the rows are cut to real descendants
// here: a path that merely contains the text elsewhere is not a conflict, and a
// descendant is found wherever it sits in the list. An error on any read
// rejects: a check that could not run is not a check that passed.
async function existsByBasePath(
  basePath: string,
  options?: RequestInit,
): Promise<DistributionRef | null> {
  const [sameOrAncestor, nested] = await Promise.all([
    distributionsList(
      {
        base_path__in: basePathAncestors(basePath),
        fields: FIELDS,
        limit: 10,
      },
      options,
    ),
    nestedBelow(basePath, options),
  ]);

  const found =
    parseResponse(refPageSchema, sameOrAncestor).results[0] ??
    nested.find((row) => isUnderBasePath(row.base_path, basePath));

  return found ? refOf(found) : null;
}

async function nestedBelow(
  basePath: string,
  options?: RequestInit,
): Promise<DistributionRef[]> {
  const rows: DistributionRef[] = [];

  for (;;) {
    const page = parseResponse(
      refPageSchema,
      await distributionsList(
        {
          base_path__contains: `${basePath}/`,
          fields: FIELDS,
          offset: rows.length,
          limit: PAGE_SIZE,
        },
        options,
      ),
    );
    rows.push(...page.results);

    // An empty page ends the read even when the server names a next page, so a
    // list that shrank while it was read never loops.
    if (!page.next || page.results.length === 0) {
      return rows;
    }
  }
}

export const DistributionClient = { existsByName, existsByBasePath };
