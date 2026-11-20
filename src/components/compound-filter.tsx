import { t } from '@lingui/core/macro';
import {
  Badge,
  Button,
  ButtonVariant,
  DropdownItem,
  InputGroup,
  InputGroupItem,
  MenuToggle,
  type MenuToggleElement,
  Select,
  SelectGroup,
  SelectList,
  SelectOption,
  TextInput,
} from '@patternfly/react-core';
import FilterIcon from '@patternfly/react-icons/dist/esm/icons/filter-icon';
import SearchIcon from '@patternfly/react-icons/dist/esm/icons/search-icon';
import { useState } from 'react';
import { StatefulDropdown, Typeahead } from 'src/components';
import { ParamHelper } from 'src/utilities';

export interface FilterOption {
  id: string;
  title: string;
  placeholder?: string;
  inputType?: 'text-field' | 'select' | 'multiple' | 'typeahead';
  options?: { id: string; title: string }[];
  hidden?: boolean;
}

interface IProps {
  filterConfig: FilterOption[];
  inputText: string;
  onChange: (inputText: string) => void;
  params;
  selectFilter?: (filterId: string) => void;
  updateParams: (params) => void;
}

export const CompoundFilter = ({
  filterConfig,
  inputText,
  onChange,
  params,
  selectFilter,
  updateParams,
}: IProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [chosenFilter, setSelectedFilter] = useState(filterConfig[0]);

  if (filterConfig.length === 0) {
    return null;
  }

  // The filter in use as the config describes it now. Its options may arrive
  // after the filter was chosen, so the config is read again and not the object
  // that was clicked.
  const selectedFilter =
    filterConfig.find(({ id }) => id === chosenFilter.id) ?? chosenFilter;

  const visibleFilters = filterConfig.filter(({ hidden }) => !hidden);

  const filterOptions = visibleFilters.map((v) => (
    <DropdownItem
      onClick={() => {
        onChange('');
        setSelectedFilter(v);
        if (selectFilter) {
          selectFilter(v.id);
        }
      }}
      key={v.id}
    >
      {v.title}
    </DropdownItem>
  ));

  return (
    <InputGroup data-cy='compound_filter'>
      {visibleFilters.length !== 1 && (
        <InputGroupItem>
          <StatefulDropdown
            toggleType='dropdown'
            defaultText={
              <span>
                <FilterIcon />
                {'   '}
                {selectedFilter.title}
              </span>
            }
            position='left'
            isPlain={false}
            items={filterOptions}
          />
        </InputGroupItem>
      )}
      <InputGroupItem isFill>{renderInput()}</InputGroupItem>
      <InputGroupItem>
        <Button
          aria-label={t`Search`}
          icon={<SearchIcon />}
          onClick={() => submitFilter()}
          variant={ButtonVariant.control}
          isDisabled={!inputText.trim().length}
        ></Button>
      </InputGroupItem>
    </InputGroup>
  );

  function renderInput() {
    switch (selectedFilter.inputType) {
      case 'multiple': {
        const selected = selectedValues();

        return (
          <Select
            role='menu'
            isOpen={isOpen}
            selected={selected}
            onSelect={(_event, value) => onSelectMultiple(String(value))}
            onOpenChange={setIsOpen}
            toggle={(toggleRef) => (
              <MenuToggle
                ref={toggleRef}
                onClick={() => setIsOpen(!isOpen)}
                isExpanded={isOpen}
                isFullWidth
                badge={
                  selected.length ? (
                    <Badge isRead>{selected.length}</Badge>
                  ) : undefined
                }
              >
                {t`Filter by ${selectedFilter.id.toLowerCase()}`}
              </MenuToggle>
            )}
          >
            <SelectGroup
              label={t`Filter by ${selectedFilter.id}`}
              key={selectedFilter.id}
            >
              <SelectList>
                {selectedFilter.options.map((option) => (
                  <SelectOption
                    key={option.id}
                    value={option.id}
                    hasCheckbox
                    isSelected={selected.includes(option.id)}
                  >
                    {option.title}
                  </SelectOption>
                ))}
              </SelectList>
            </SelectGroup>
          </Select>
        );
      }
      case 'select':
        return (
          <Select
            isOpen={isOpen}
            selected={inputText}
            onSelect={(_event, value) => {
              setIsOpen(false);
              onChange(String(value));
              submitFilter(String(value));
            }}
            onOpenChange={setIsOpen}
            toggle={(toggleRef: React.Ref<MenuToggleElement>) => (
              <MenuToggle
                ref={toggleRef}
                onClick={() => setIsOpen(!isOpen)}
                isExpanded={isOpen}
                isFullWidth
              >
                {selectTitleById(inputText, selectedFilter) ||
                  selectedFilter.placeholder ||
                  selectedFilter.title}
              </MenuToggle>
            )}
          >
            <SelectList>
              {selectedFilter.options.map((v) => (
                <SelectOption key={v.id} value={v.id}>
                  {v.title}
                </SelectOption>
              ))}
            </SelectList>
          </Select>
        );
      case 'typeahead': {
        const needle = inputText.trim().toLowerCase();
        const typeaheadResults = filterConfig
          .find(({ id }) => id === selectedFilter.id)
          .options.map(({ id, title }) => ({ id, name: title }))
          .filter(({ name }) => name.toLowerCase().includes(needle));

        return (
          <Typeahead
            loadResults={(name) => {
              onChange(name);
            }}
            onClear={() => {
              onChange('');
            }}
            onSelect={(event, value) => {
              const item = selectedFilter.options.find(
                ({ title }) => title === value,
              );
              submitFilter(item?.id || value);
            }}
            placeholderText={
              selectedFilter?.placeholder ||
              t`Filter by ${selectedFilter.title.toLowerCase()}`
            }
            results={typeaheadResults}
          />
        );
      }
      default:
        return (
          <TextInput
            aria-label={selectedFilter.id}
            placeholder={
              selectedFilter.placeholder ||
              t`Filter by ${selectedFilter.title.toLowerCase()}`
            }
            value={inputText}
            onChange={(_event, k) => onChange(k)}
            onKeyDown={(e) => handleEnter(e)}
          />
        );
    }
  }

  function handleEnter(e) {
    // l10n: don't translate
    if (e.key === 'Enter' && inputText.trim().length > 0) {
      submitFilter();
    }
  }

  function submitMultiple(newValues: string[]) {
    updateParams({
      ...ParamHelper.setParam(params, selectedFilter.id, newValues),
      page: 1,
    });
  }

  function submitFilter(id = undefined) {
    updateParams({
      ...ParamHelper.setParam(params, selectedFilter.id, id ? id : inputText),
      page: 1,
    });
  }

  // no tags => falsy
  // 1 tag => "foo"
  // 2+ tags => ["foo", "bar"]
  // normalised to an array
  function selectedValues(): string[] {
    const current = params[selectedFilter.id];

    if (!current) {
      return [];
    }
    return Array.isArray(current) ? current : [current];
  }

  function onSelectMultiple(id: string) {
    const current = selectedValues();

    submitMultiple(
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  }

  function selectTitleById(inputText: string, selectedFilter: FilterOption) {
    if (!inputText || !selectedFilter?.options) {
      return inputText;
    }

    return selectedFilter.options.find((opt) => opt.id === inputText)?.title;
  }
};
