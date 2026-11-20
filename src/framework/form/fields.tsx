import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import {
  Checkbox,
  FormSelect,
  FormSelectOption,
  TextArea,
  TextInput,
} from '@patternfly/react-core';
import type { RemoteBase } from 'src/entities/plugin/model';
import type { RemoteEntity } from 'src/entities/plugin/remote';
import type { FieldDef } from '../descriptor';
import type { LabelRow } from './form-values';
import { LabelsField } from './labels-field';
import { RemoteField } from './remote-field';

interface Props {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  isDisabled: boolean;
  // Whether the server refused this field's value, for the input's state.
  hasError: boolean;
  // The plugin's remotes, for a field of the kind `remote`.
  remotes?: RemoteEntity<RemoteBase, never, never>;
}

// The input of one field of a descriptor's form: the plugin's own input when
// the field declares one, otherwise the input of its kind. The inputs are
// controlled and hold the form's representation of the value (see form-values).
export const FieldInput = ({
  field,
  value,
  onChange,
  isDisabled,
  hasError,
  remotes,
}: Props) => {
  const id = field.name;
  const validated = hasError ? 'error' : 'default';

  if (field.widget) {
    return field.widget({
      id,
      value,
      onChange,
      isDisabled,
      error: undefined,
    });
  }

  switch (field.kind) {
    case 'boolean':
      return (
        <Checkbox
          id={id}
          isChecked={value === true}
          isDisabled={isDisabled}
          label={field.boxLabel ? i18n._(field.boxLabel) : i18n._(field.label)}
          onChange={(_event, checked) => onChange(checked)}
        />
      );
    case 'select': {
      const chosen = typeof value === 'string' ? value : '';
      const options = field.options ?? [];

      return (
        <FormSelect
          id={id}
          value={chosen}
          isDisabled={isDisabled}
          validated={validated}
          onChange={(_event, next) => onChange(next)}
        >
          {options.every((option) => option.value !== chosen) ? (
            <FormSelectOption
              value={chosen}
              label={t`Not set`}
              isDisabled
              isPlaceholder
            />
          ) : null}
          {options.map((option) => (
            <FormSelectOption
              key={option.value}
              value={option.value}
              label={i18n._(option.label)}
            />
          ))}
        </FormSelect>
      );
    }
    case 'textarea':
      return (
        <TextArea
          id={id}
          value={String(value ?? '')}
          isDisabled={isDisabled}
          validated={validated}
          resizeOrientation='vertical'
          onChange={(_event, next) => onChange(next)}
        />
      );
    case 'labels':
      return (
        <LabelsField
          id={id}
          rows={value as LabelRow[]}
          isDisabled={isDisabled}
          onChange={onChange}
        />
      );
    case 'remote':
      return remotes ? (
        <RemoteField
          remotes={remotes}
          value={(value as string | null) ?? null}
          isDisabled={isDisabled}
          onChange={onChange}
        />
      ) : null;
    default:
      return (
        <TextInput
          id={id}
          type={
            field.kind === 'integer'
              ? 'number'
              : field.kind === 'secret'
                ? 'password'
                : field.kind === 'url'
                  ? 'url'
                  : 'text'
          }
          value={String(value ?? '')}
          isRequired={field.required}
          isDisabled={isDisabled}
          validated={validated}
          onChange={(_event, next) => onChange(next)}
        />
      );
  }
};
