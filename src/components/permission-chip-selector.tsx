import { t } from '@lingui/core/macro';
import { Label } from '@patternfly/react-core';
import { useState } from 'react';
import { LabelGroup, Typeahead } from 'src/components';

interface IProps {
  availablePermissions?: string[];
  isDisabled?: boolean;
  isViewOnly?: boolean;
  onCategoryClear?: () => void;
  onPermissionToggle?: (permission: string) => void;
  selectedPermissions: string[];
}

// FIXME
const model_permissions = {};

const permissionLabel = (permission: string) =>
  model_permissions[permission]?.name || permission;

export const PermissionChipSelector = ({
  availablePermissions = [],
  isDisabled,
  isViewOnly,
  onCategoryClear,
  onPermissionToggle,
  selectedPermissions,
}: IProps) => {
  const [filter, setFilter] = useState('');

  if (isViewOnly) {
    const items = selectedPermissions.map((permission) => ({
      label: permissionLabel(permission),
      value: permission,
    }));

    return (
      <LabelGroup>
        {items.length ? null : (
          <Label key='placeholder'>{t`No permission`}</Label>
        )}
        {items.map((text) => (
          <Label key={text.value} title={text.value}>
            {text.label}
          </Label>
        ))}
      </LabelGroup>
    );
  }

  const toOption = (permission: string) => ({
    id: permission,
    name: permissionLabel(permission),
  });

  // the permissions are all known up front, so they are narrowed here
  const needle = filter.trim().toLowerCase();
  const results = availablePermissions
    .map(toOption)
    .filter(({ name }) => name.toLowerCase().includes(needle));
  const selections = selectedPermissions.map(toOption);

  return (
    <Typeahead
      multiple
      isDisabled={!!isDisabled}
      loadResults={setFilter}
      onClear={() => onCategoryClear?.()}
      onSelect={(_event, name) => {
        const permission = [...results, ...selections].find(
          (option) => option.name === name,
        )?.id;
        onPermissionToggle?.(permission ?? name);
      }}
      placeholderText={
        !isDisabled
          ? t`Select permissions`
          : selectedPermissions.length === 0
            ? t`No permission`
            : ''
      }
      results={results}
      selections={selections}
    />
  );
};
