import { versionNumberOf } from 'src/entities/href';
import type { ServingBinding } from '../serving/served-state';

// Why the server refuses to delete a repository version. The rules are the
// server's: a version is protected while a distribution is bound to it, while
// a distribution is bound to a publication made from it, and while a
// distribution that is bound to the repository serves it. A repository whose
// last version is deleted has no content to serve, so that is refused too.
export type ProtectionReason =
  // a distribution is bound to this version
  | { kind: 'version-bound'; distributions: string[] }
  // a distribution is bound to a publication made from this version
  | { kind: 'publication-bound'; distributions: string[] }
  // a repository-bound distribution serves the newest published version
  | { kind: 'serves-published'; distributions: string[] }
  // a repository-bound distribution of a plugin that serves versions directly
  // serves the latest version
  | { kind: 'serves-latest'; distributions: string[] }
  // the repository has no other version
  | { kind: 'only-version' };

// A distribution of the repository, as far as what it serves goes.
export interface ProtectingDistribution extends ServingBinding {
  name: string;
  // A checkpoint distribution is served by time and not by the newest
  // publication.
  checkpoint?: boolean | null;
}

export interface ProtectionFacts {
  // The numbers of the versions to tell about; any other is left out of the
  // answer.
  versions: readonly number[];
  // How many versions the repository has.
  totalVersions: number;
  // The distributions that serve the repository.
  distributions: readonly ProtectingDistribution[];
  // The version number of each publication a distribution is bound to, by the
  // publication's address; a publication that is not in it, or has no number,
  // protects nothing the client knows of.
  publicationVersions: ReadonlyMap<string, number | null>;
  // The version numbers of the repository's publications, or null when the
  // user may not read them or there are too many to read: what a
  // repository-bound distribution serves is then not known.
  publishedVersions: readonly number[] | null;
  // The number of the repository's latest version, or null when it has none.
  latestVersion: number | null;
  // Whether the plugin's distributions serve a publication and not the
  // repository's versions.
  servesFromPublication: boolean;
}

// The versions of the repository that cannot be deleted, each with its reasons
// in a fixed order. A version that nothing is known to protect is not in the
// answer: the server decides, and its refusal is shown.
export function protectedVersions(
  facts: ProtectionFacts,
): Map<number, ProtectionReason[]> {
  const asked = new Set(facts.versions);
  const reasons = new Map<number, ProtectionReason[]>();

  const add = (
    number: number | null,
    kind: Exclude<ProtectionReason['kind'], 'only-version'>,
    name: string,
  ) => {
    if (number === null || !asked.has(number)) {
      return;
    }
    const list = reasons.get(number) ?? [];
    const same = list.find((reason) => reason.kind === kind);
    if (same && 'distributions' in same) {
      same.distributions.push(name);
    } else {
      list.push({ kind, distributions: [name] });
    }
    reasons.set(number, list);
  };

  const newestPublished =
    facts.publishedVersions && facts.publishedVersions.length > 0
      ? Math.max(...facts.publishedVersions)
      : null;

  for (const row of facts.distributions) {
    if (row.publication) {
      add(
        facts.publicationVersions.get(row.publication) ?? null,
        'publication-bound',
        row.name,
      );
    } else if (row.repository_version) {
      add(versionNumberOf(row.repository_version), 'version-bound', row.name);
    }
  }
  // The kinds are listed in a fixed order whatever order the distributions
  // came in.
  const order: ProtectionReason['kind'][] = [
    'version-bound',
    'publication-bound',
    'serves-published',
    'serves-latest',
  ];
  for (const row of facts.distributions) {
    if (row.publication || row.repository_version || !row.repository) {
      continue;
    }
    if (facts.servesFromPublication) {
      if (row.checkpoint !== true) {
        add(newestPublished, 'serves-published', row.name);
      }
    } else {
      add(facts.latestVersion, 'serves-latest', row.name);
    }
  }
  for (const list of Array.from(reasons.values())) {
    list.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  }

  if (facts.totalVersions === 1) {
    for (const number of facts.versions) {
      reasons.set(number, [
        ...(reasons.get(number) ?? []),
        { kind: 'only-version' },
      ]);
    }
  }

  return reasons;
}
