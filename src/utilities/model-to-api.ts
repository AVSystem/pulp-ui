import { AnsibleDistributionAPI } from '../api/ansible-distribution';
import { AnsibleRemoteAPI } from '../api/ansible-remote';
import { AnsibleRepositoryAPI } from '../api/ansible-repository';
import {
  ContainerDistributionAPI,
  ContainerPullThroughDistributionAPI,
} from '../api/container-distribution';
import { DebDistributionAPI } from '../api/deb-distribution';
import { DebRepositoryAPI } from '../api/deb-repository';
import { FileDistributionAPI } from '../api/file-distribution';
import { FileRepositoryAPI } from '../api/file-repository';
import { RPMDistributionAPI } from '../api/rpm-distribution';
import { RPMRepositoryAPI } from '../api/rpm-repository';

// The API of a model label. A distribution API without a url member makes
// getDistroURL use the distribution's base_url.
export const ModelToApi = {
  filerepository: FileRepositoryAPI,
  filedistribution: FileDistributionAPI,
  aptrepository: DebRepositoryAPI,
  aptdistribution: DebDistributionAPI,
  rpmrepository: RPMRepositoryAPI,
  rpmdistribution: RPMDistributionAPI,
  ansiblerepository: AnsibleRepositoryAPI,
  ansibleremote: AnsibleRemoteAPI,
  ansibledistribution: AnsibleDistributionAPI,
  containerdistribution: ContainerDistributionAPI,
  containerpullthroughdistribution: ContainerPullThroughDistributionAPI,
};
