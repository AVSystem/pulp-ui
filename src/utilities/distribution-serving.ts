// Serving rules for distributions. The UI never rebuilds a content URL from
// base_path; it shows the one the server returns. Whether a distribution is
// served is derived from publications the way the content app does it, so a
// distribution that answers 404 is flagged instead of shown as healthy.

export type ServedState = 'served' | 'not-served';

// Whether a plugin's distributions need a publication to serve content.
// Ansible serves from the repository version directly.
export const SERVES_FROM_PUBLICATION: Record<
  'ansible' | 'deb' | 'file' | 'rpm',
  boolean
> = {
  ansible: false,
  deb: true,
  file: true,
  rpm: true,
};

export interface DistributionUrlSource {
  base_url?: string | null;
  client_url?: string | null;
}

export interface DistributionBinding {
  publication?: string | null;
  repository?: string | null;
  repository_version?: string | null;
}

export interface PublicationRef {
  pulp_href: string;
  repository_version?: string | null;
}

// The URL the server reports: base_url, or client_url for ansible
// distributions, which carry no base_url. Null when neither is present.
export function distributionUrl(
  distribution: DistributionUrlSource,
): string | null {
  return distribution.base_url || distribution.client_url || null;
}

// Whether a distribution serves content. `publications` are the publications
// of the distribution's repository.
//   - a plugin that does not serve from publications: always served
//   - publication-bound: served
//   - repository-bound: served when the repository has at least one publication
//   - version-bound: served when that exact version has a publication
//   - bound to nothing: not served
export function servedState(
  distribution: DistributionBinding,
  servesFromPublication: boolean,
  publications: PublicationRef[],
): ServedState {
  if (!servesFromPublication || distribution.publication) {
    return 'served';
  }
  if (distribution.repository_version) {
    return publications.some(
      (publication) =>
        publication.repository_version === distribution.repository_version,
    )
      ? 'served'
      : 'not-served';
  }
  if (distribution.repository) {
    return publications.length > 0 ? 'served' : 'not-served';
  }
  return 'not-served';
}

// The repository href a repository version href belongs to: the trailing
// versions/<n>/ segment is cut off. Null for no version.
export function repositoryOfVersion(
  versionHref: string | null | undefined,
): string | null {
  if (!versionHref) {
    return null;
  }
  return versionHref.replace(/versions\/\d+\/?$/, '');
}
