import { msg } from '@lingui/core/macro';
import { Paths, formatPath } from 'src/paths';
import { ACTION_PERMISSIONS } from '../utilities/action-permissions';
import { Action } from './action';

export const rpmRepositoryCreateAction = Action({
  title: msg`Add repository`,
  permission: ACTION_PERMISSIONS.rpm.repository.add,
  objectLevel: false,
  onClick: (item, { navigate }) =>
    navigate(formatPath(Paths.rpm.repository.edit, { name: '_' })),
});
