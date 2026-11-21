import type { GenericRemote } from './common';
import { PulpAPI } from './pulp';

/**
 * File Remote Type.
 *
 * @see https://github.com/pulp/pulpcore/blob/934c752dae916857b2005e1fe0ef75496accc082/pulp_file/app/serializers.py#L165
 */
interface FileRemoteType extends GenericRemote {
  /**
   * NOTE: Not part of the File serializer, populated separately.
   * This should be broken out into its own type and extend the interface.
   */
  my_permissions?: string[];
}

const base = new PulpAPI();

export const FileRemoteAPI = {
  list: (params?) => base.list(`remotes/file/file/`, params),
};

export type { FileRemoteType };
