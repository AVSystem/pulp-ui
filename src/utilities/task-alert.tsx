import { Trans } from '@lingui/react/macro';
import { type ReactNode } from 'react';
import { taskHref, taskUrlId } from 'src/entities/core/task/href';
import { Paths, formatPath } from 'src/paths';
import { MaybeLink } from '../components/maybe-link';

type VariantType = 'custom' | 'success' | 'danger' | 'warning' | 'info';

// task can be { task: (pulp_href) } or "(pulp_href)" or "(uuid)"
export const taskAlert = (
  task,
  title: string | ReactNode,
  variant: VariantType = 'info',
) => {
  // an id is turned into the address of its task first, so the address of the
  // detail page is always built from the address of a task
  const reference = task?.task || task;
  const target = taskHref(reference) ?? reference;

  return {
    title,
    variant,
    description: (
      <span>
        <Trans>
          See the task management{' '}
          <MaybeLink
            to={
              taskUrlId(target)
                ? formatPath(Paths.core.task.detail, {
                    task: taskUrlId(target),
                  })
                : null
            }
          >
            detail page{' '}
          </MaybeLink>
          for the status of this task.
        </Trans>
      </span>
    ),
  };
};
