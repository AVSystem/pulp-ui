import { msg } from '@lingui/core/macro';
import { Paths, formatPath } from 'src/paths';
import { ACTION_PERMISSIONS } from '../utilities/action-permissions';
import { Action } from './action';

export const ansibleRemoteEditAction = Action({
  title: msg`Edit`,
  permission: ACTION_PERMISSIONS.ansible.remote.change,
  onClick: ({ name }, { navigate }) =>
    navigate(formatPath(Paths.ansible.remote.edit, { name })),
});
