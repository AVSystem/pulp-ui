import type { GenericRemote } from './common';
import { PulpAPI } from './pulp';

/**
 * RPM Remote Type.
 *
 * @see https://github.com/pulp/pulp_rpm/blob/main/pulp_rpm/app/serializers/repository.py
 */
interface RPMRemoteType extends GenericRemote {
  sles_auth_token?: string | null;
}

const base = new PulpAPI();

export const RPMRemoteAPI = {
  list: (params?) => base.list(`remotes/rpm/rpm/`, params),
};

export type { RPMRemoteType };
