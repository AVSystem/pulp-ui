import { screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import { CompoundFilter, type FilterOption } from './compound-filter';

const nameFilter: FilterOption = { id: 'name__contains', title: 'Name' };
const stateFilter: FilterOption = {
  id: 'state',
  title: 'Status',
  inputType: 'select',
  options: [
    { id: 'completed', title: 'Completed' },
    { id: 'failed', title: 'Failed' },
  ],
};
const labelFilter: FilterOption = {
  id: 'label',
  title: 'Label',
  inputType: 'multiple',
  options: [
    { id: 'blue', title: 'Blue' },
    { id: 'green', title: 'Green' },
  ],
};
const remoteFilter: FilterOption = {
  id: 'remote',
  title: 'Remote',
  inputType: 'typeahead',
  options: [
    { id: 'null', title: 'None' },
    { id: 'r1', title: 'pypi' },
    { id: 'r2', title: 'npmjs' },
  ],
};

// Holds the typed text and the params the way the list screens do.
const Harness = ({
  filterConfig,
  params = {},
  updateParams,
  selectFilter,
}: {
  filterConfig: FilterOption[];
  params?: object;
  updateParams: (params) => void;
  selectFilter?: (id: string) => void;
}) => {
  const [inputText, setInputText] = useState('');
  const [current, setCurrent] = useState(params);

  return (
    <CompoundFilter
      filterConfig={filterConfig}
      inputText={inputText}
      onChange={setInputText}
      params={current}
      selectFilter={selectFilter}
      updateParams={(next) => {
        setCurrent(next);
        updateParams(next);
      }}
    />
  );
};

describe('CompoundFilter', () => {
  it('renders nothing without filters', () => {
    const { container } = renderWithProviders(
      <Harness filterConfig={[]} updateParams={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('lists the visible filters in the category menu and reports the choice', async () => {
    const selectFilter = vi.fn();
    const { user } = renderWithProviders(
      <Harness
        filterConfig={[
          nameFilter,
          stateFilter,
          { ...labelFilter, hidden: true },
        ]}
        selectFilter={selectFilter}
        updateParams={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Name/ }));

    expect(
      await screen.findByRole('menuitem', { name: 'Status' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: 'Label' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('menuitem', { name: 'Status' }));

    expect(selectFilter).toHaveBeenCalledWith('state');
  });

  it('offers no category menu when there is a single filter', () => {
    renderWithProviders(
      <Harness filterConfig={[nameFilter]} updateParams={vi.fn()} />,
    );

    expect(
      screen.queryByRole('button', { name: /Name/ }),
    ).not.toBeInTheDocument();
  });

  it('submits a text filter on Enter under the filter id and resets the page', async () => {
    const updateParams = vi.fn();
    const { user } = renderWithProviders(
      <Harness
        filterConfig={[nameFilter]}
        params={{ page: 3 }}
        updateParams={updateParams}
      />,
    );

    await user.type(screen.getByRole('textbox'), 'admin{Enter}');

    expect(updateParams).toHaveBeenCalledTimes(1);
    expect(updateParams).toHaveBeenCalledWith({
      name__contains: 'admin',
      page: 1,
    });
  });

  it('submits a text filter with the search button, disabled until text is typed', async () => {
    const updateParams = vi.fn();
    const { user } = renderWithProviders(
      <Harness filterConfig={[nameFilter]} updateParams={updateParams} />,
    );

    const search = screen.getByRole('button', { name: 'Search' });
    expect(search).toBeDisabled();

    await user.type(screen.getByRole('textbox'), 'ad');
    await user.click(search);

    expect(updateParams).toHaveBeenCalledWith({
      name__contains: 'ad',
      page: 1,
    });
  });

  it('offers the options of a select filter and applies the chosen id', async () => {
    const updateParams = vi.fn();
    const { user } = renderWithProviders(
      <Harness filterConfig={[stateFilter]} updateParams={updateParams} />,
    );

    await user.click(screen.getByRole('button', { name: /Status/ }));
    expect(
      await screen.findByRole('option', { name: 'Completed' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'Failed' }));

    expect(updateParams).toHaveBeenCalledWith({ state: 'failed', page: 1 });
  });

  it('adds and removes the chosen options of a multiple filter', async () => {
    const updateParams = vi.fn();
    const { user } = renderWithProviders(
      <Harness filterConfig={[labelFilter]} updateParams={updateParams} />,
    );

    await user.click(screen.getByRole('button', { name: /Filter by label/ }));
    await user.click(await screen.findByRole('checkbox', { name: /Blue/ }));
    expect(updateParams).toHaveBeenLastCalledWith({ label: ['blue'], page: 1 });

    expect(screen.getByRole('checkbox', { name: /Blue/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Green/ })).not.toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: /Green/ }));
    expect(updateParams).toHaveBeenLastCalledWith({
      label: ['blue', 'green'],
      page: 1,
    });

    await user.click(screen.getByRole('checkbox', { name: /Blue/ }));
    expect(updateParams).toHaveBeenLastCalledWith({
      label: ['green'],
      page: 1,
    });
  });

  it('narrows the options of a typeahead filter as the user types and applies the id', async () => {
    const updateParams = vi.fn();
    const { user } = renderWithProviders(
      <Harness filterConfig={[remoteFilter]} updateParams={updateParams} />,
    );

    await user.type(screen.getByRole('combobox'), 'np');

    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getAllByRole('option')).toHaveLength(1);

    await user.click(within(listbox).getByRole('option', { name: 'npmjs' }));

    expect(updateParams).toHaveBeenCalledWith({ remote: 'r2', page: 1 });
  });

  it('applies the id of a typeahead option that arrived after the filter was chosen', async () => {
    const updateParams = vi.fn();
    const noneOnly: FilterOption = {
      ...remoteFilter,
      options: [{ id: 'null', title: 'None' }],
    };
    const loaded: FilterOption = {
      ...remoteFilter,
      options: [
        { id: 'null', title: 'None' },
        { id: 'r2', title: 'npmjs' },
      ],
    };
    const { user, rerender } = renderWithProviders(
      <Harness
        filterConfig={[nameFilter, noneOnly]}
        updateParams={updateParams}
      />,
    );
    await user.click(
      within(
        document.querySelector('[data-cy="compound_filter"]') as HTMLElement,
      ).getAllByRole('button')[0] as HTMLElement,
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Remote' }));

    // the options are read after the filter was chosen
    rerender(
      <Harness
        filterConfig={[nameFilter, loaded]}
        updateParams={updateParams}
      />,
    );
    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'npmjs' }));

    expect(updateParams).toHaveBeenCalledWith({ remote: 'r2', page: 1 });
  });
});
