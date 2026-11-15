import { List } from '@patternfly/react-core';
import { Td } from '@patternfly/react-table';
import { type ReactNode, createContext, useContext } from 'react';
import { StatefulDropdown } from 'src/components';

// Set by a list page that knows its row actions: whether any row shows one.
// Outside such a page it is undefined and a row always has its actions cell.
export const RowActionsColumn = createContext<boolean | undefined>(undefined);

interface IProps {
  kebabItems?: ReactNode[];
  buttons?: ReactNode[];
}

export function ListItemActions(props: IProps) {
  const buttons = props.buttons?.filter(Boolean);
  const kebabItems = props.kebabItems?.filter(Boolean);
  const anyButtons = buttons?.length;
  const anyKebab = kebabItems?.length;
  const column = useContext(RowActionsColumn);

  // No row of the list has an action, so there is no column to fill: the cell
  // is left out of every row, not drawn empty. A row that does carry an action
  // always keeps it.
  if (column === false && !anyButtons && !anyKebab) {
    return null;
  }

  return (
    <Td
      style={{
        paddingRight: anyKebab ? '0px' : '16px',
        textAlign: 'right',
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      {anyButtons ? (
        <>
          <List>{buttons}</List>{' '}
        </>
      ) : null}
      {anyKebab ? (
        <div data-cy='kebab-toggle'>
          <StatefulDropdown items={kebabItems} />{' '}
        </div>
      ) : null}
    </Td>
  );
}
