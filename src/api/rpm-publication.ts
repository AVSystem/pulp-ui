import type { GenericPublication } from './common';
import { PulpAPI } from './pulp';

/**
 * RPM Publication Type.
 *
 * @see https://github.com/pulp/pulp_rpm/blob/main/pulp_rpm/app/serializers/repository.py
 */
interface RPMPublicationType extends GenericPublication {
  readonly distributions?: string[];
}

const base = new PulpAPI();

export const RPMPublicationAPI = {
  list: (params?) => base.list(`publications/rpm/rpm/`, params),
};

export type { RPMPublicationType };
