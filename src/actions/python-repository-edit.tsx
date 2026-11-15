import { msg } from '@lingui/core/macro';
import { Paths, formatPath } from 'src/paths';
import { ACTION_PERMISSIONS } from '../utilities/action-permissions';
import { Action } from './action';

export const pythonRepositoryEditAction = Action({
  title: msg`Edit`,
  permission: ACTION_PERMISSIONS.python.repository.change,
  onClick: ({ name }, { navigate }) =>
    navigate(formatPath(Paths.python.repository.edit, { name })),
});
