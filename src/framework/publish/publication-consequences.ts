import { versionNumberOf } from 'src/entities/href';
import {
  type PublicationFact,
  type ServingBinding,
  servedPublication,
} from '../serving/served-state';

// What a publication of a repository says to the rules that tell which
// publication a distribution serves.
export interface PublicationRow {
  pulp_href: string;
  repository_version?: string | null;
  pulp_created?: string | null;
}

// A distribution of the repository, as far as what it serves goes.
export interface ConsequenceDistribution extends ServingBinding {
  name: string;
  pulp_href: string;
  // A checkpoint distribution is served by timestamp and never by a
  // publication it is bound to.
  checkpoint?: boolean | null;
}

// What a distribution serves once a publication is gone.
export type AfterDelete =
  // the content app answers 404
  | { kind: 'nothing' }
  // an older publication is served instead, made from this version
  | { kind: 'version'; version: number };

export interface Consequence<D extends ConsequenceDistribution> {
  distribution: D;
  after: AfterDelete;
}

const factsOf = (rows: readonly PublicationRow[]): PublicationFact[] =>
  rows.map((row) => ({
    pulp_href: row.pulp_href,
    repository_version: row.repository_version,
    version: versionNumberOf(row.repository_version),
    created: row.pulp_created,
  }));

// Whether a distribution is served from a publication at all.
const servedFromPublication = (distribution: ConsequenceDistribution) =>
  distribution.checkpoint !== true;

// The publication a distribution serves among the publications of its
// repository, or null when it serves none.
export function publicationServedBy(
  distribution: ConsequenceDistribution,
  publications: readonly PublicationRow[],
): PublicationRow | null {
  if (!servedFromPublication(distribution)) {
    return null;
  }
  const served = servedPublication(distribution, factsOf(publications));

  return (
    publications.find(({ pulp_href }) => pulp_href === served?.pulp_href) ??
    null
  );
}

// What deleting a publication does to the distributions that serve it: each
// distribution that serves it now, and what it serves afterwards. The server
// deletes a served publication without protection, so this is all the warning
// the user gets. A distribution that serves another publication is not listed,
// and neither is one bound to nothing or served by timestamp. `publications`
// holds every publication of the repository, the one to delete included.
export function consequencesOfDelete<D extends ConsequenceDistribution>(
  publication: Pick<PublicationRow, 'pulp_href'>,
  publications: readonly PublicationRow[],
  distributions: readonly D[],
): Consequence<D>[] {
  const left = factsOf(
    publications.filter(({ pulp_href }) => pulp_href !== publication.pulp_href),
  );

  return distributions.flatMap((distribution) => {
    if (
      publicationServedBy(distribution, publications)?.pulp_href !==
      publication.pulp_href
    ) {
      return [];
    }
    // A publication binding that lost its publication finds none: the server
    // does not look for another one.
    const next = servedPublication(distribution, left);
    const after: AfterDelete =
      next && next.version !== null
        ? { kind: 'version', version: next.version }
        : { kind: 'nothing' };

    return [{ distribution, after }];
  });
}
