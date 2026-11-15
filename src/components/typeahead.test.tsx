import { screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import { Typeahead } from './typeahead';

interface Item {
  name: string;
  id: number | string;
}

const results: Item[] = [
  { id: 1, name: 'admin' },
  { id: 2, name: 'adrian' },
];

// Keeps the selection in state the way the screens that use the typeahead do.
const Harness = ({
  multiple,
  onSelect,
  loadResults = () => undefined,
  onClear,
  ...rest
}: Partial<React.ComponentProps<typeof Typeahead>>) => {
  const [selections, setSelections] = useState<Item[]>([]);

  return (
    <Typeahead
      results={results}
      loadResults={loadResults}
      multiple={multiple}
      placeholderText='Select users'
      selections={selections}
      onSelect={(event, selection, isPlaceholder) => {
        onSelect?.(event, selection, isPlaceholder);
        const item = results.find(({ name }) => name === selection);
        if (!item) {
          return;
        }
        setSelections((current) => {
          const exists = current.some(({ name }) => name === selection);
          if (multiple) {
            return exists
              ? current.filter(({ name }) => name !== selection)
              : [...current, item];
          }
          return [item];
        });
      }}
      onClear={() => {
        setSelections([]);
        onClear?.();
      }}
      {...rest}
    />
  );
};

describe('Typeahead', () => {
  it('asks for results with the typed text and lists them as options', async () => {
    const loadResults = vi.fn();
    const { user } = renderWithProviders(<Harness loadResults={loadResults} />);

    await user.type(screen.getByRole('combobox'), 'ad');

    expect(loadResults).toHaveBeenLastCalledWith('ad');
    const listbox = await screen.findByRole('listbox');
    expect(
      within(listbox).getByRole('option', { name: 'admin' }),
    ).toBeInTheDocument();
    expect(
      within(listbox).getByRole('option', { name: 'adrian' }),
    ).toBeInTheDocument();
  });

  it('shows a disabled entry when there are no results', async () => {
    const { user } = renderWithProviders(
      <Harness results={[]} placeholderText='Select users' />,
    );

    await user.click(screen.getByRole('combobox'));

    expect(
      await screen.findByRole('option', { name: 'Not found' }),
    ).toBeDisabled();
  });

  it('passes the selected name to onSelect, closes the menu and shows the name', async () => {
    const onSelect = vi.fn();
    const loadResults = vi.fn();
    const { user } = renderWithProviders(
      <Harness onSelect={onSelect} loadResults={loadResults} />,
    );

    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'adrian' }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][1]).toBe('adrian');
    expect(loadResults).toHaveBeenLastCalledWith('');
    await waitFor(() =>
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('combobox')).toHaveValue('adrian');
  });

  it('selects the focused option with the keyboard', async () => {
    const onSelect = vi.fn();
    const { user } = renderWithProviders(<Harness onSelect={onSelect} />);

    await user.click(screen.getByRole('combobox'));
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(onSelect.mock.calls[0][1]).toBe('adrian');
  });

  it('closes the menu with Escape', async () => {
    const { user } = renderWithProviders(<Harness />);

    await user.click(screen.getByRole('combobox'));
    await screen.findByRole('listbox');
    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument(),
    );
  });

  it('shows the selections as removable labels in multiple mode', async () => {
    const onSelect = vi.fn();
    const { user } = renderWithProviders(
      <Harness multiple onSelect={onSelect} />,
    );

    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'admin' }));

    // the menu stays open and the choice is marked as selected
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'admin' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('option', { name: 'adrian' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    // once as the option and once as the label of the selection
    expect(screen.getAllByText('admin')).toHaveLength(2);
    const closeButton = screen.getByRole('button', { name: 'close' });

    await user.click(closeButton);

    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect.mock.calls[1][1]).toBe('admin');
    expect(
      screen.queryByRole('button', { name: 'close' }),
    ).not.toBeInTheDocument();
  });

  it('clears the input and the selections with the clear button', async () => {
    const onClear = vi.fn();
    const loadResults = vi.fn();
    const { user } = renderWithProviders(
      <Harness multiple onClear={onClear} loadResults={loadResults} />,
    );

    await user.type(screen.getByRole('combobox'), 'ad');
    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(loadResults).toHaveBeenLastCalledWith('');
    expect(screen.getByRole('combobox')).toHaveValue('');
  });

  it('disables the input when isDisabled is set', () => {
    renderWithProviders(<Harness isDisabled />);

    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('renders endLink as a link at the end of the list', async () => {
    const { user } = renderWithProviders(
      <Harness endLink={{ href: '/ui/more', name: 'See all' }} />,
    );

    await user.click(screen.getByRole('combobox'));

    // an anchor inside a listbox is exposed as an option
    const link = await screen.findByRole('option', { name: 'See all' });
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/ui/more');
    const options = screen.getAllByRole('option');
    expect(options[options.length - 1]).toBe(link);
  });
});
