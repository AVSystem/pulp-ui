import { plural, t } from '@lingui/core/macro';
import { Content, DropdownItem, ToolbarItem } from '@patternfly/react-core';
import type { ReactNode } from 'react';
import { StatefulDropdown } from 'src/components';
import type { BulkTarget } from './bulk-actions';

// The menu of bulk actions in a list's toolbar, and the question of which rows
// the user may act on. An action the user may not take on any of the rows in
// reach is absent from the menu; it is never drawn disabled for that reason.
// The only disabled state is the one that says nothing is selected yet.

// An action of the menu. `permission` is a key of the plugin's manifest, as for
// the row actions.
export interface BulkMenuAction<Key extends string> {
  id: string;
  permission: Key;
  label: string;
}

// Whether the user may act on a row, as the list decides it.
export type Permits<Key extends string, Row> = (
  permission: Key,
  row: Row,
) => boolean;

// The actions the user may take on at least one of the rows. `rows` is the
// selection, or the whole page while nothing is selected.
export function offeredActions<Key extends string, Row>(
  actions: readonly BulkMenuAction<Key>[],
  rows: readonly Row[],
  permits: Permits<Key, Row>,
): BulkMenuAction<Key>[] {
  return actions.filter(({ permission }) =>
    rows.some((row) => permits(permission, row)),
  );
}

// Splits the selected rows into those the action is sent for and the names of
// those the user may not act on, which are listed and not sent.
export function splitByPermission<Key extends string, Row extends BulkTarget>(
  rows: readonly Row[],
  permission: Key,
  permits: Permits<Key, Row>,
): { allowed: Row[]; refused: string[] } {
  const allowed: Row[] = [];
  const refused: string[] = [];
  for (const row of rows) {
    if (permits(permission, row)) {
      allowed.push(row);
    } else {
      refused.push(row.name);
    }
  }

  return { allowed, refused };
}

interface ToolbarProps<Key extends string> {
  actions: readonly BulkMenuAction<Key>[];
  // How many rows are selected; the actions wait for at least one.
  count: number;
  onChoose: (action: BulkMenuAction<Key>) => void;
}

// How many rows are selected, in words.
export const selectedText = (count: number): string =>
  plural(count, { one: '# row selected', other: '# rows selected' });

// The count of selected rows and the menu of actions, as items of the list's
// toolbar. Nothing is drawn when no action is offered and no row is selected.
// When rows are selected but none of them may be acted on, the count stays and
// says why there is no menu, so the ticked boxes are not left unexplained.
export function BulkToolbar<Key extends string>({
  actions,
  count,
  onChoose,
}: ToolbarProps<Key>): ReactNode {
  if (actions.length === 0) {
    return count > 0 ? (
      <>
        <ToolbarItem>
          <Content component='small' aria-live='polite'>
            {selectedText(count)}
          </Content>
        </ToolbarItem>
        <ToolbarItem>
          <Content component='small'>
            {t`You may not take a bulk action on the selected rows.`}
          </Content>
        </ToolbarItem>
      </>
    ) : null;
  }

  return (
    <>
      <ToolbarItem>
        <Content component='small' aria-live='polite'>
          {count > 0 ? selectedText(count) : t`No rows selected`}
        </Content>
      </ToolbarItem>
      <ToolbarItem>
        <StatefulDropdown
          toggleType='dropdown'
          isPlain={false}
          position='left'
          defaultText={t`Bulk actions`}
          data-cy='BulkActions'
          items={actions.map((action) => (
            <DropdownItem
              key={action.id}
              isDisabled={count === 0}
              onClick={() => onChoose(action)}
            >
              {action.label}
            </DropdownItem>
          ))}
        />
      </ToolbarItem>
    </>
  );
}
