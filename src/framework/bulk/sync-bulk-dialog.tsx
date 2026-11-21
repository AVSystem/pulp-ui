import { t } from '@lingui/core/macro';
import { Form } from '@patternfly/react-core';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { AlertType } from 'src/components';
import { taskKeys } from 'src/entities/core/task/queries';
import type { RepositoryBase } from 'src/entities/plugin/model';
import type { PluginDescriptor, SyncOptionDef } from '../descriptor';
import { OptionField } from '../sync/sync-dialog';
import { useWatchTask } from '../watched-tasks';
import { bulkSync, watchLimiter } from './bulk-actions';
import type { OnSettled } from './bulk-actions';
import { BulkDialog } from './bulk-dialog';

interface Props {
  descriptor: PluginDescriptor;
  // The rows the user may sync.
  rows: readonly RepositoryBase[];
  notPermitted: readonly string[];
  onClose: () => void;
  onFinished: (alert: AlertType) => void;
}

// What every option holds before the user touches it. The options are chosen
// once for all the rows, so an option that depends on the repository starts at
// the value of the first row it is free for: a row it is held for is synced
// with the value that is allowed whatever is chosen here.
function startingValues(
  options: readonly SyncOptionDef<RepositoryBase>[],
  rows: readonly RepositoryBase[],
): Record<string, unknown> {
  return Object.fromEntries(
    options.map((option) => {
      const free = rows.find((row) => !option.fixed?.(row));
      const row = free ?? rows[0];
      return [option.name, row ? option.initial(row) : undefined];
    }),
  );
}

// Starts a sync of every selected repository that has a remote, with the
// options chosen once. A repository with no remote is skipped and says so. Each
// sync is a task of its own: the result table links it, and the first ones are
// followed by the application, which announces their end wherever the user is.
export const SyncBulkDialog = ({
  descriptor,
  rows,
  notPermitted,
  onClose,
  onFinished,
}: Props) => {
  const queryClient = useQueryClient();
  const { watch } = useWatchTask();
  const { entity, sync } = descriptor.repository;
  const options = sync?.options ?? [];
  const [values, setValues] = useState(() => startingValues(options, rows));

  const listed = useMemo(
    () =>
      rows.map((row) => {
        const held = options
          .map((option) => option.fixed?.(row)?.reason)
          .find((reason) => reason !== undefined);
        return {
          pulp_href: row.pulp_href,
          name: row.name,
          note: row.remote ? held : t`Has no remote, so it is skipped`,
        };
      }),
    [rows, options],
  );

  if (!sync) {
    return null;
  }

  const run = async (onSettled: OnSettled) => {
    const follow = watchLimiter();
    try {
      return await bulkSync(
        entity,
        sync,
        rows,
        values,
        (row, task) => {
          if (follow()) {
            const { name } = row;
            watch({
              href: task,
              label: t`Sync of ${name}`,
              resource: {
                app: entity.app,
                object: entity.object,
                href: row.pulp_href,
              },
            });
          }
          void queryClient.invalidateQueries({
            queryKey: taskKeys.activeOf(row.pulp_href),
          });
        },
        onSettled,
      );
    } finally {
      void queryClient.invalidateQueries({ queryKey: taskKeys.index });
    }
  };

  return (
    <BulkDialog
      title={t`Sync selected repositories`}
      lead={t`A sync is started for every selected repository that has a remote, with the options below. Each sync runs as a task of its own.`}
      confirmLabel={t`Sync`}
      rows={listed}
      notPermitted={notPermitted}
      options={
        options.length > 0 ? (
          <Form
            onSubmit={(event) => {
              event.preventDefault();
            }}
          >
            {options.map((option) => (
              <OptionField
                key={option.name}
                option={option}
                value={values[option.name]}
                isDisabled={false}
                hint={
                  option.fixed
                    ? t`A repository for which this cannot be turned on is synced with the value that is allowed.`
                    : undefined
                }
                onChange={(value) =>
                  setValues((current) => ({ ...current, [option.name]: value }))
                }
              />
            ))}
          </Form>
        ) : null
      }
      run={run}
      alertTitle={() => t`Syncing the selected repositories was requested`}
      onClose={onClose}
      onFinished={onFinished}
    />
  );
};
