import { msg } from '@lingui/core/macro';
import { Paths, formatPath } from 'src/paths';
import { ACTION_PERMISSIONS } from '../utilities/action-permissions';
import { Action } from './action';

export const debRepositoryCreateAction = Action({
  title: msg`Add repository`,
  permission: ACTION_PERMISSIONS.deb.repository.add,
  objectLevel: false,
  onClick: (item, { navigate }) =>
    navigate(formatPath(Paths.deb.repository.edit, { name: '_' })),
});
