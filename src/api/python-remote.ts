import type { GenericRemote } from './common';
import { PulpAPI } from './pulp';

type PythonPackageType =
  | 'bdist_dmg'
  | 'bdist_dumb'
  | 'bdist_egg'
  | 'bdist_msi'
  | 'bdist_rpm'
  | 'bdist_wheel'
  | 'bdist_wininst'
  | 'sdist';
type PythonPlatform = 'windows' | 'macos' | 'freebsd' | 'linux';

/**
 * Python Remote Type.
 *
 * @see https://github.com/pulp/pulp_python/blob/main/pulp_python/app/serializers.py
 */
interface PythonRemoteType extends GenericRemote {
  includes?: string[];
  excludes?: string[];
  prereleases?: boolean;
  package_types?: PythonPackageType[];
  keep_latest_packages?: number;
  exclude_platforms?: PythonPlatform[];
  provenance?: boolean;
}

const base = new PulpAPI();

export const PythonRemoteAPI = {
  list: (params?) => base.list(`remotes/python/python/`, params),
};

export type { PythonPackageType, PythonPlatform, PythonRemoteType };
