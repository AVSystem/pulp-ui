import { msg } from '@lingui/core/macro';
import { Paths, formatPath } from 'src/paths';
import { ACTION_PERMISSIONS } from '../utilities/action-permissions';
import { Action } from './action';

export const ansibleRepositoryEditAction = Action({
  title: msg`Edit`,
  permission: ACTION_PERMISSIONS.ansible.repository.change,
  onClick: ({ name }, { navigate }) =>
    navigate(formatPath(Paths.ansible.repository.edit, { name })),
});
