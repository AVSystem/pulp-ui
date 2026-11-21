import { AnsibleDistributionAPI } from '../api/ansible-distribution';
import { AnsibleRemoteAPI } from '../api/ansible-remote';
import { AnsibleRepositoryAPI } from '../api/ansible-repository';
import { DebDistributionAPI } from '../api/deb-distribution';
import { DebRemoteAPI } from '../api/deb-remote';
import { DebRepositoryAPI } from '../api/deb-repository';
import { FileDistributionAPI } from '../api/file-distribution';
import { FileRemoteAPI } from '../api/file-remote';
import { FileRepositoryAPI } from '../api/file-repository';
import { PythonDistributionAPI } from '../api/python-distribution';
import { PythonRemoteAPI } from '../api/python-remote';
import { PythonRepositoryAPI } from '../api/python-repository';
import { RPMDistributionAPI } from '../api/rpm-distribution';
import { RPMRemoteAPI } from '../api/rpm-remote';
import { RPMRepositoryAPI } from '../api/rpm-repository';

// The request layer of each plugin whose repositories, remotes and
// distributions the legacy helpers can act on.
export function plugin2api(plugin) {
  switch (plugin) {
    case 'ansible':
      return {
        DistributionAPI: AnsibleDistributionAPI,
        RemoteAPI: AnsibleRemoteAPI,
        RepositoryAPI: AnsibleRepositoryAPI,
      };
    case 'deb':
      return {
        DistributionAPI: DebDistributionAPI,
        RemoteAPI: DebRemoteAPI,
        RepositoryAPI: DebRepositoryAPI,
      };
    case 'file':
      return {
        DistributionAPI: FileDistributionAPI,
        RemoteAPI: FileRemoteAPI,
        RepositoryAPI: FileRepositoryAPI,
      };
    case 'python':
      return {
        DistributionAPI: PythonDistributionAPI,
        RemoteAPI: PythonRemoteAPI,
        RepositoryAPI: PythonRepositoryAPI,
      };
    case 'rpm':
      return {
        DistributionAPI: RPMDistributionAPI,
        RemoteAPI: RPMRemoteAPI,
        RepositoryAPI: RPMRepositoryAPI,
      };
    default:
      return {};
  }
}
