// What a distribution serves, decided once for every screen. The rules are the
// ones the content app follows (see Distribution.get_repository_publication_and_version
// in pulpcore) and were measured on a running server; each rule below says
// which wrong statement it keeps off the screen.
//
// A distribution of a plugin that serves from publications (file, deb, rpm)
// answers with the newest publication of the highest repository version that
// has one, whatever the creation order of the publications; it answers 404 only
// when nothing is published or when it is bound to nothing. Plugins that serve
// versions directly (python, maven, npm, ansible, container) never need a
// publication, so no warning is ever computed for them.
//
// The module is pure and imports only types, so screens and tests use it alike.
// Reading publications is a permission of its own: a user who may read
// distributions and repositories but not publications sees an empty publication
// list, which must never be told as "serves nothing".

// The three fields a distribution is bound to what it serves.
export interface ServingBinding {
  repository?: string | null;
  publication?: string | null;
  repository_version?: string | null;
}

export interface ServingInput {
  // Whether the plugin's distributions need a publication to serve content.
  servesFromPublication: boolean;
  // A checkpoint distribution serves by timestamp, not by the newest publication.
  checkpoint?: boolean;
  // The user holds the plugin's global publication view permission, or is a
  // superuser. Without it the publications the user can read prove nothing.
  canReadPublications: boolean;
  // More publications exist than the index of them reads, so the ones read are
  // not all of them.
  indexOverBound?: boolean;
  binding: ServingBinding;
  // The number of the latest version of the repository served, or null when it
  // is not known.
  latestVersion: number | null;
  // The version number of each publication of the repository served, as many
  // entries as publications, in any order.
  publishedVersions: readonly number[];
  // The number of the version a version-bound distribution is bound to.
  boundVersion?: number | null;
  // The version number of the publication a publication-bound distribution is
  // bound to, when it is known.
  publicationVersion?: number | null;
}

export type ServedKind =
  // the content is served and is the newest there is
  | 'served'
  // an older publication is served than the latest version
  | 'stale'
  // the content app answers 404: there is nothing to serve
  | 'no-publication'
  // no binding is set: the content app answers 404
  | 'unbound'
  // the user may not read what is needed to tell
  | 'cannot-check'
  // the plugin or the distribution has no such rule
  | 'not-applicable';

// What would fix a state, as the screens offer it.
export type ServingFix =
  'publish-latest' | 'serve-newest' | 'publish-version' | 'edit';

export interface ServedState {
  state: ServedKind;
  // the version served and the latest one, for a stale state
  servedVersion?: number;
  latestVersion?: number;
  // why a distribution cannot be checked
  reason?: 'no-permission' | 'too-many';
  // a fact to show next to a state that has no warning
  note?: 'deprecated-publication';
  fix: ServingFix | null;
}

const SERVED: ServedState = { state: 'served', fix: null };

// The state of a distribution bound to a repository or to a version of one.
// The publications of the repository must be known, so a user who cannot read
// them gets no answer at all.
function ofPublications(
  input: ServingInput,
  whenKnown: () => ServedState,
): ServedState {
  if (!input.canReadPublications) {
    return { state: 'cannot-check', reason: 'no-permission', fix: null };
  }
  if (input.indexOverBound) {
    return { state: 'cannot-check', reason: 'too-many', fix: null };
  }
  return whenKnown();
}

// A stale state, when the newest published version is older than the latest.
function staleOrServed(
  servedVersion: number,
  latestVersion: number | null,
  fix: ServingFix,
): ServedState {
  return latestVersion !== null && servedVersion < latestVersion
    ? { state: 'stale', servedVersion, latestVersion, fix }
    : SERVED;
}

// The state of one distribution.
//   - a plugin that serves versions directly: not applicable, so a python or
//     maven distribution is never reported as serving nothing for lack of a
//     publication; a python distribution bound to a publication carries a note,
//     because publications are deprecated there
//   - bound to nothing: the content app answers 404 whoever asks, so it is said
//     to every user
//   - checkpoint: not applicable, it is served by timestamp
//   - bound to a publication: it serves that publication, so it is served for
//     every user; it is stale when the publication is older than the latest
//     version, which only a user who can read publications is told
//   - bound to a version: served when that exact version has a publication,
//     never stale (pinned on purpose), cannot be checked without the permission
//   - bound to a repository: served by the newest publication of any version,
//     so older publications only make it stale; 404 only without any
function servedState(input: ServingInput): ServedState {
  const { repository, publication, repository_version } = input.binding;

  if (!input.servesFromPublication) {
    return publication
      ? { state: 'not-applicable', note: 'deprecated-publication', fix: null }
      : { state: 'not-applicable', fix: null };
  }
  if (!repository && !publication && !repository_version) {
    return { state: 'unbound', fix: 'edit' };
  }
  if (input.checkpoint) {
    return { state: 'not-applicable', fix: null };
  }
  if (publication) {
    const { publicationVersion } = input;
    return input.canReadPublications &&
      publicationVersion !== undefined &&
      publicationVersion !== null
      ? staleOrServed(publicationVersion, input.latestVersion, 'serve-newest')
      : SERVED;
  }
  if (repository_version) {
    return ofPublications(input, () =>
      input.boundVersion !== undefined &&
      input.boundVersion !== null &&
      input.publishedVersions.includes(input.boundVersion)
        ? SERVED
        : { state: 'no-publication', fix: 'publish-version' },
    );
  }
  return ofPublications(input, () =>
    input.publishedVersions.length === 0
      ? { state: 'no-publication', fix: 'publish-latest' }
      : staleOrServed(
          Math.max(...input.publishedVersions),
          input.latestVersion,
          'publish-latest',
        ),
  );
}

// Whether a state is worth drawing next to a URL: every state but a plain
// served one, and a not-applicable one that carries no note.
function isNoteworthy(state: ServedState): boolean {
  return (
    state.state !== 'served' &&
    (state.state !== 'not-applicable' || state.note !== undefined)
  );
}

// What the rules need of one publication of a repository.
export interface PublicationFact {
  pulp_href: string;
  // The address of the version it was made from, to match a version binding.
  repository_version?: string | null;
  // That version's number, or null when it is not known.
  version: number | null;
  // When it was made; of two publications of one version the later wins.
  created?: string | null;
}

// The later of two publications by creation time, the first when they tie.
const newer = (a: PublicationFact, b: PublicationFact) =>
  (b.created ?? '') > (a.created ?? '') ? b : a;

// The publication a distribution serves, or null when it serves none. The
// rules are those of `servedState`: a publication binding serves that
// publication, a version binding the newest publication of exactly that
// version, a repository binding the newest publication of the highest version
// that has one. `publications` are the publications of the repository served.
function servedPublication(
  binding: ServingBinding,
  publications: readonly PublicationFact[],
): PublicationFact | null {
  const { repository, publication, repository_version } = binding;

  if (publication) {
    return publications.find((row) => row.pulp_href === publication) ?? null;
  }
  if (repository_version) {
    return publications
      .filter((row) => row.repository_version === repository_version)
      .reduce<PublicationFact | null>(
        (best, row) => (best ? newer(best, row) : row),
        null,
      );
  }
  if (!repository) {
    return null;
  }
  return publications.reduce<PublicationFact | null>((best, row) => {
    if (row.version === null) {
      return best;
    }
    if (!best || best.version === null || row.version > best.version) {
      return row;
    }
    return row.version === best.version ? newer(best, row) : best;
  }, null);
}

export { isNoteworthy, servedPublication, servedState };
