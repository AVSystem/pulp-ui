import { msg } from '@lingui/core/macro';
import { Paths, formatPath } from 'src/paths';
import { ACTION_PERMISSIONS } from '../utilities/action-permissions';
import { Action } from './action';

export const rpmRepositoryEditAction = Action({
  title: msg`Edit`,
  permission: ACTION_PERMISSIONS.rpm.repository.change,
  onClick: ({ name }, { navigate }) =>
    navigate(formatPath(Paths.rpm.repository.edit, { name })),
});
