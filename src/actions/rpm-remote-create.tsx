import { msg } from '@lingui/core/macro';
import { Paths, formatPath } from 'src/paths';
import { ACTION_PERMISSIONS } from '../utilities/action-permissions';
import { Action } from './action';

export const rpmRemoteCreateAction = Action({
  title: msg`Add remote`,
  permission: ACTION_PERMISSIONS.rpm.remote.add,
  objectLevel: false,
  onClick: (item, { navigate }) =>
    navigate(formatPath(Paths.rpm.remote.edit, { name: '_' })),
});
