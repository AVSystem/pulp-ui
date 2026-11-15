import { msg } from '@lingui/core/macro';
import { Paths, formatPath } from 'src/paths';
import { ACTION_PERMISSIONS } from '../utilities/action-permissions';
import { Action } from './action';

export const fileRepositoryCreateAction = Action({
  title: msg`Add repository`,
  permission: ACTION_PERMISSIONS.file.repository.add,
  objectLevel: false,
  onClick: (item, { navigate }) =>
    navigate(formatPath(Paths.file.repository.edit, { name: '_' })),
});
