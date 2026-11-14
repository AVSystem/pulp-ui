import { t } from '@lingui/core/macro';
import {
  Dropdown,
  DropdownList,
  MenuToggle,
  type MenuToggleElement,
} from '@patternfly/react-core';
import EllipsisVIcon from '@patternfly/react-icons/dist/esm/icons/ellipsis-v-icon';
import { type ReactNode, type Ref, useState } from 'react';

interface IProps {
  /** List of patternfly DropdownItem components */
  items: ReactNode[];

  /** Callback fired when the user selects an item */
  onSelect?: (event) => void;

  /** If not specified, dropdown button will be a kebab. icon simply removes the dropdown indicator */
  toggleType?: 'dropdown' | 'icon' | 'kebab';

  /** Text to display on the component when it's not expanded*/
  defaultText?: ReactNode;

  /** Specifies if the dropdown should be aligned to the left or the right of the toggle button*/
  position?: 'left' | 'right';

  /** Toggles between plain and normal patternfly styling */
  isPlain?: boolean;

  ariaLabel?: string;
  /** Extra class on the toggle button */
  toggleClassName?: string;
  'data-cy'?: string;
}

export const StatefulDropdown = ({
  items,
  onSelect: onSelectProp,
  toggleType = 'kebab',
  position,
  defaultText,
  isPlain = true,
  ariaLabel,
  toggleClassName,
  'data-cy': dataCy,
}: IProps) => {
  const [isOpen, setOpen] = useState<boolean>(false);

  const toggleProps = {
    'aria-label': ariaLabel,
    className: toggleClassName,
    'data-cy': dataCy,
    isExpanded: isOpen,
    onClick: () => setOpen(!isOpen),
  };

  const renderToggle = (toggleRef: Ref<MenuToggleElement>) => {
    switch (toggleType) {
      case 'dropdown':
        return (
          <MenuToggle
            ref={toggleRef}
            variant={isPlain ? 'plainText' : 'default'}
            {...toggleProps}
          >
            {defaultText || t`Dropdown`}
          </MenuToggle>
        );
      case 'icon':
        return (
          <MenuToggle ref={toggleRef} variant='plain' {...toggleProps}>
            {defaultText || t`Dropdown`}
          </MenuToggle>
        );
      case 'kebab':
        return (
          <MenuToggle
            ref={toggleRef}
            variant='plain'
            {...toggleProps}
            aria-label={ariaLabel || t`Actions`}
          >
            <EllipsisVIcon />
          </MenuToggle>
        );
    }
  };

  return (
    <Dropdown
      isOpen={isOpen}
      onOpenChange={setOpen}
      onSelect={(event) => {
        setOpen(false);
        onSelectProp?.(event);
      }}
      shouldFocusToggleOnSelect
      popperProps={{ position: position === 'left' ? 'start' : 'end' }}
      toggle={renderToggle}
    >
      <DropdownList>{items}</DropdownList>
    </Dropdown>
  );
};
