import { AnsibleDistributionAPI } from '../api/ansible-distribution';
import {
  ContainerDistributionAPI,
  ContainerPullThroughDistributionAPI,
} from '../api/container-distribution';

// The distribution APIs that know the address clients use to reach a
// distribution (client_url, registry_path, a host and base path), by model
// label. getDistroURL uses base_url for a distribution that has none here.
export const ModelToApi = {
  ansibledistribution: AnsibleDistributionAPI,
  containerdistribution: ContainerDistributionAPI,
  containerpullthroughdistribution: ContainerPullThroughDistributionAPI,
};
