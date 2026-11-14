import { Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Table } from './table';

const renderTable = (props: Partial<Parameters<typeof Table>[0]> = {}) =>
  render(
    <Table aria-label='Things' {...props}>
      <Thead>
        <Tr>
          <Th>Name</Th>
        </Tr>
      </Thead>
      <Tbody>
        <Tr>
          <Td dataLabel='Name'>example-1</Td>
        </Tr>
      </Tbody>
    </Table>,
  );

describe('Table', () => {
  it('forwards the props to the PatternFly table', () => {
    renderTable({ variant: 'compact', 'data-cy': 'things' } as never);

    const table = screen.getByRole('grid', { name: 'Things' });
    expect(table.className).toContain('pf-m-compact');
    expect(table.getAttribute('data-cy')).toBe('things');
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeTruthy();
    expect(screen.getByText('example-1')).toBeTruthy();
  });

  it('keeps rows as rows at every width', () => {
    renderTable();

    expect(screen.getByRole('grid').className).not.toMatch(/pf-m-grid/);
  });

  it('lets a caller pick a grid breakpoint', () => {
    renderTable({ gridBreakPoint: 'grid-lg' });

    expect(screen.getByRole('grid').className).toMatch(/pf-m-grid-lg/);
  });

  it('puts the table in a container that scrolls sideways', () => {
    renderTable();

    const container = screen.getByRole('grid').parentElement;
    expect(container?.className).toBe('pulp-table-scroll');
  });
});

describe('the container rule', () => {
  it('scrolls horizontally in the shell styles', () => {
    const styles = readFileSync(
      resolve(import.meta.dirname, '../theme/shell.scss'),
      'utf8',
    );
    const rule = /\.pulp-table-scroll\s*\{([^}]*)\}/.exec(styles);

    expect(rule).not.toBeNull();
    expect(rule?.[1]).toMatch(/overflow-x:\s*auto/);
  });
});
