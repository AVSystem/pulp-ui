import { Table as PFTable, type TableProps } from '@patternfly/react-table';

// Every table of the app comes from here. PatternFly turns a table into
// stacked cards below a width unless the grid breakpoint is empty; a card per
// row hides the column structure of list screens, so rows stay rows at every
// width and a table wider than its container scrolls sideways inside its own
// box instead of widening the page.
export const Table = ({ gridBreakPoint = '', ...props }: TableProps) => (
  <div className='pulp-table-scroll'>
    <PFTable gridBreakPoint={gridBreakPoint} {...props} />
  </div>
);
