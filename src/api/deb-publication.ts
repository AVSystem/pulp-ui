import type { GenericPublication } from './common';
import { PulpAPI } from './pulp';

/**
 * Deb Publication Type (apt and verbatim publications share this shape).
 */
interface DebPublicationType extends GenericPublication {
  simple?: boolean;
  structured?: boolean;
}

const base = new PulpAPI();

export const DebPublicationAPI = {
  list: (params?) => base.list(`publications/deb/apt/`, params),
};

// A deb distribution may serve either kind of publication.
export const DebVerbatimPublicationAPI = {
  list: (params?) => base.list(`publications/deb/verbatim/`, params),
};

export type { DebPublicationType };
