import { AnsibleRepositoryAPI } from '../api/ansible-repository';
import { repositoryVersionRevertAction } from './repository-version-revert';

export const ansibleRepositoryVersionRevertAction =
  repositoryVersionRevertAction(AnsibleRepositoryAPI);
