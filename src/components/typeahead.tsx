import { t } from '@lingui/core/macro';
import {
  Button,
  Label,
  MenuToggle,
  type MenuToggleElement,
  Select,
  SelectList,
  SelectOption,
  TextInputGroup,
  TextInputGroupMain,
  TextInputGroupUtilities,
} from '@patternfly/react-core';
import TimesIcon from '@patternfly/react-icons/dist/esm/icons/times-icon';
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type RefObject,
  useId,
  useRef,
  useState,
} from 'react';
import { LabelGroup } from 'src/components';

interface IProps {
  results: { name: string; id: number | string }[];
  loadResults: (filter: string) => void;
  onSelect: (event, selection, isPlaceholder) => void;

  selections?: { name: string; id: number | string }[];
  multiple?: boolean;
  placeholderText?: string;
  onClear?: () => void;

  isDisabled?: boolean;
  endLink?: {
    href: string;
    name: string;
  };
  menuAppendTo?: 'parent' | 'inline';
  toggleIcon?: ReactElement;
  style?: CSSProperties;
}

// A search field with a list of options that the caller fetches: every
// keystroke goes to loadResults and the options are whatever the caller hands
// back in results, so filtering happens on the server, not here.
export const Typeahead = ({
  results,
  loadResults,
  onSelect,
  selections = [],
  multiple,
  placeholderText,
  onClear,
  isDisabled,
  endLink,
  menuAppendTo,
  toggleIcon,
  style,
}: IProps) => {
  const [isOpen, setIsOpen] = useState(false);
  // null while the user is not typing, so a single selection shows its name
  const [typedText, setTypedText] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selectedNames = selections.map(({ name }) => name);
  const inputValue = typedText ?? (multiple ? '' : (selectedNames[0] ?? ''));

  // the entries the keyboard can move through: enabled options, then the link
  const options = results.map(({ id, name }) => ({ key: String(id), name }));
  const optionIds = options.map((_, i) => `${listId}-option-${i}`);
  const linkId = `${listId}-end-link`;
  const focusableIds = [...optionIds, ...(endLink ? [linkId] : [])];
  const activeId =
    focusedIndex === null ? undefined : focusableIds[focusedIndex];

  const open = () => {
    if (!isDisabled) {
      setIsOpen(true);
    }
  };

  const hide = () => {
    setIsOpen(false);
    setFocusedIndex(null);
  };

  // Closing without a choice drops what was typed in a single-select field,
  // so the field shows the value that is really selected, and asks for the
  // full list again since the narrowed one no longer matches the field.
  const close = () => {
    hide();
    if (!multiple && typedText !== null) {
      setTypedText(null);
      loadResults('');
    }
  };

  const selectOption = (event, name: string) => {
    onSelect(event, name, false);

    if (!multiple) {
      setTypedText(null);
      hide();
      loadResults('');
    }
    inputRef.current?.focus();
  };

  const onTextChange = (_event, value: string) => {
    setTypedText(value);
    setFocusedIndex(null);
    open();
    loadResults(value);
  };

  const onClearClick = () => {
    setTypedText(null);
    setFocusedIndex(null);
    loadResults('');
    onClear?.();
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The keys of a text composition (an input method editor) belong to it:
    // Enter commits the composed text and must not choose an option.
    if (event.nativeEvent.isComposing) {
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!isOpen) {
          open();
          return;
        }
        if (focusableIds.length === 0) {
          return;
        }
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setFocusedIndex((current) =>
          current === null
            ? step === 1
              ? 0
              : focusableIds.length - 1
            : (current + step + focusableIds.length) % focusableIds.length,
        );
        break;
      }
      case 'Enter': {
        event.preventDefault();
        if (!isOpen) {
          open();
        } else if (focusedIndex !== null && focusedIndex < options.length) {
          selectOption(event, options[focusedIndex].name);
        } else if (focusedIndex !== null && endLink) {
          document.getElementById(linkId)?.click();
        }
        break;
      }
    }
  };

  const toggleNode = (
    <MenuToggle
      ref={toggleRef as RefObject<MenuToggleElement>}
      variant='typeahead'
      aria-label={t`Options`}
      aria-haspopup='listbox'
      onClick={() => (isOpen ? close() : open())}
      isExpanded={isOpen}
      isDisabled={isDisabled}
      isFullWidth
      icon={toggleIcon}
      style={style}
    >
      <TextInputGroup isPlain isDisabled={isDisabled}>
        <TextInputGroupMain
          value={inputValue}
          onClick={open}
          onChange={onTextChange}
          onKeyDown={onKeyDown}
          innerRef={inputRef}
          autoComplete='off'
          placeholder={placeholderText}
          aria-label={placeholderText}
          aria-activedescendant={activeId}
          aria-controls={listId}
          role='combobox'
          isExpanded={isOpen}
        >
          {multiple && selections.length > 0 && (
            <LabelGroup aria-label={t`Current selections`}>
              {selections.map(({ id, name }) => (
                <Label
                  key={id}
                  variant='outline'
                  isDisabled={isDisabled}
                  closeBtnAriaLabel={t`close`}
                  onClose={(event: MouseEvent) => {
                    event.stopPropagation();
                    onSelect(event, name, false);
                  }}
                >
                  {name}
                </Label>
              ))}
            </LabelGroup>
          )}
        </TextInputGroupMain>
        {!isDisabled && (inputValue || selections.length > 0) && (
          <TextInputGroupUtilities>
            <Button
              variant='plain'
              onClick={onClearClick}
              aria-label={t`Clear`}
              icon={<TimesIcon aria-hidden />}
            />
          </TextInputGroupUtilities>
        )}
      </TextInputGroup>
    </MenuToggle>
  );

  return (
    <Select
      variant='typeahead'
      isOpen={isOpen}
      selected={selectedNames}
      onSelect={(event, value) => {
        if (typeof value === 'string') {
          selectOption(event, value);
        }
      }}
      onOpenChange={(nextOpen) => (nextOpen ? open() : close())}
      toggle={{ toggleNode, toggleRef }}
      popperProps={{
        appendTo:
          menuAppendTo === 'parent'
            ? () => toggleRef.current?.parentElement ?? document.body
            : 'inline',
      }}
    >
      <SelectList id={listId}>
        {options.length === 0 ? (
          <SelectOption key='not_found' isDisabled>
            {t`Not found`}
          </SelectOption>
        ) : (
          options.map(({ key, name }, i) => (
            <SelectOption
              key={key}
              id={optionIds[i]}
              value={name}
              isFocused={focusedIndex === i}
            >
              {name}
            </SelectOption>
          ))
        )}
        {endLink && (
          <SelectOption
            key='end-link'
            id={linkId}
            to={endLink.href}
            isFocused={focusedIndex === options.length}
          >
            {endLink.name}
          </SelectOption>
        )}
      </SelectList>
    </Select>
  );
};
