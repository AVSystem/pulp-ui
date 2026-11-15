import { msg } from '@lingui/core/macro';
import { Paths, formatPath } from 'src/paths';
import { ACTION_PERMISSIONS } from '../utilities/action-permissions';
import { Action } from './action';

export const rpmRemoteEditAction = Action({
  title: msg`Edit`,
  permission: ACTION_PERMISSIONS.rpm.remote.change,
  onClick: ({ name }, { navigate }) =>
    navigate(formatPath(Paths.rpm.remote.edit, { name })),
});
