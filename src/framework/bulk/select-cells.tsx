import { Checkbox } from '@patternfly/react-core';
import tableStyles from '@patternfly/react-styles/css/components/Table/table.mjs';
import { Td } from '@patternfly/react-table';

// The check box of a row of a list, in the narrow column PatternFly gives the
// selection of a table. Its name says which row it ticks, which the check box
// PatternFly builds itself cannot.
export const SelectCell = ({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) => (
  <Td className={tableStyles.tableCheck}>
    <Checkbox
      id={id}
      aria-label={label}
      isChecked={checked}
      onChange={(_event, next) => onChange(next)}
    />
  </Td>
);
