import { msg } from '@lingui/core/macro';
import { Paths, formatPath } from 'src/paths';
import { ACTION_PERMISSIONS } from '../utilities/action-permissions';
import { Action } from './action';

export const fileRemoteEditAction = Action({
  title: msg`Edit`,
  permission: ACTION_PERMISSIONS.file.remote.change,
  onClick: ({ name }, { navigate }) =>
    navigate(formatPath(Paths.file.remote.edit, { name })),
});
