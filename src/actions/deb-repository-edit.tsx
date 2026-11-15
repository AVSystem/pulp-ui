import { msg } from '@lingui/core/macro';
import { Paths, formatPath } from 'src/paths';
import { ACTION_PERMISSIONS } from '../utilities/action-permissions';
import { Action } from './action';

export const debRepositoryEditAction = Action({
  title: msg`Edit`,
  permission: ACTION_PERMISSIONS.deb.repository.change,
  onClick: ({ name }, { navigate }) =>
    navigate(formatPath(Paths.deb.repository.edit, { name })),
});
