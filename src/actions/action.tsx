import { type MessageDescriptor, i18n } from '@lingui/core';
import { Button } from '@patternfly/react-core';
import { DropdownItem } from '@patternfly/react-core';
import { type ReactNode } from 'react';
import { Tooltip } from '../components/patternfly-wrappers/tooltip';

type ModalType = ({
  addAlert,
  isMounted,
  listQuery,
  query,
  queueAlert,
  reloadPage,
  setState,
  state,
}: {
  addAlert;
  // whether the page the dialog belongs to is still on screen; absent where
  // the context cannot tell
  isMounted?: () => boolean;
  listQuery;
  query;
  // keeps an alert for the next screen the user lands on
  queueAlert?: (alert) => void;
  reloadPage;
  setState;
  state;
}) => ReactNode;

interface ActionParams {
  buttonVariant?: 'primary' | 'secondary';
  condition?: (item, actionContext) => boolean;
  disabled?: (item, actionContext) => string | ReactNode | null;
  modal?: ModalType;
  // false: the permission is checked only as held on every object, never from
  // the permissions of the object the action acts on (for actions that create
  // something, or whose object has no permission list)
  objectLevel?: boolean;
  onClick: (item, actionContext) => void;
  // The permission that lets the user use the action. Without it the action is
  // absent, never disabled: with an item (and objectLevel) the permissions of
  // that object count too, else only those held on every object.
  permission?: string;
  title: MessageDescriptor;
  visible?: (item, actionContext) => boolean;
}

export class ActionType {
  button: (item, actionContext) => ReactNode | null;
  disabled: (item, actionContext) => string | ReactNode | null;
  dropdownItem: (item, actionContext) => ReactNode | null;
  // whether the action is offered for the item: its condition holds, its
  // explicit visible check agrees and the user holds its permission
  isShown: (item, actionContext) => boolean;
  modal?: ModalType;
  objectLevel: boolean;
  permission?: string;
  title: string;
  visible: (item, actionContext) => boolean;
}

export const Action = ({
  buttonVariant,
  condition = () => true,
  disabled = () => null,
  modal = null,
  objectLevel = true,
  onClick,
  permission,
  title,
  visible = () => true,
}: ActionParams): ActionType => {
  const permitted = (item, actionContext) => {
    if (!permission) {
      return true;
    }

    return item && objectLevel && actionContext.hasObjectPermission
      ? !!actionContext.hasObjectPermission(permission, item)
      : !!actionContext.hasPermission?.(permission);
  };

  const isShown = (item, actionContext) =>
    condition(item, actionContext) &&
    visible(item, actionContext) &&
    permitted(item, actionContext);

  return {
    // getter to prevent lingui from throwing when instantiated before lingui activate
    get title() {
      return i18n._(title);
    },
    button: (item, actionContext) =>
      isShown(item, actionContext) ? (
        disabled(item, actionContext) ? (
          <Tooltip content={disabled(item, actionContext)} key={i18n._(title)}>
            <Button variant={buttonVariant} isDisabled>
              {i18n._(title)}
            </Button>
          </Tooltip>
        ) : (
          <Button
            variant={buttonVariant}
            key={i18n._(title)}
            onClick={() => onClick(item, actionContext)}
          >
            {i18n._(title)}
          </Button>
        )
      ) : null,
    dropdownItem: (item, actionContext) =>
      isShown(item, actionContext) ? (
        disabled(item, actionContext) ? (
          <DropdownItem
            key={i18n._(title)}
            description={disabled(item, actionContext)}
            isAriaDisabled
          >
            {i18n._(title)}
          </DropdownItem>
        ) : (
          <DropdownItem
            key={i18n._(title)}
            onClick={() => onClick(item, actionContext)}
          >
            {i18n._(title)}
          </DropdownItem>
        )
      ) : null,
    isShown,
    modal,
    objectLevel,
    permission,
    visible,
    disabled,
  };
};
