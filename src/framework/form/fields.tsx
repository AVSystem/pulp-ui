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
import { CertificateField } from './certificate-field';
import { type LabelRow, type SecretValue, isSecret } from './form-values';
import { LabelsField } from './labels-field';
import { RemoteField } from './remote-field';
import { SecretField } from './secret-field';

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

  if (isSecret(field)) {
    const label = i18n._(field.label);

    return (
      <SecretField
        id={id}
        value={value as SecretValue}
        label={label}
        isDisabled={isDisabled}
        hasError={hasError}
        onChange={onChange}
        input={
          field.kind === 'certificate'
            ? ({ id: inputId, text, onText }) => (
                <CertificateField
                  id={inputId}
                  value={text}
                  label={label}
                  isDisabled={isDisabled}
                  hasError={hasError}
                  canDownload={false}
                  onChange={onText}
                />
              )
            : field.kind === 'secret'
              ? undefined
              : ({ id: inputId, text, onText }) => (
                  <TextInput
                    id={inputId}
                    type='text'
                    autoComplete='off'
                    value={text}
                    isDisabled={isDisabled}
                    validated={hasError ? 'error' : 'default'}
                    onChange={(_event, next) => onText(next)}
                  />
                )
        }
      />
    );
  }

  switch (field.kind) {
    case 'certificate':
      return (
        <CertificateField
          id={id}
          value={String(value ?? '')}
          label={i18n._(field.label)}
          isDisabled={isDisabled}
          hasError={hasError}
          canDownload
          onChange={onChange}
        />
      );
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
    case 'lines':
      return (
        <TextArea
          id={id}
          value={String(value ?? '')}
          placeholder={field.placeholder}
          isDisabled={isDisabled}
          validated={validated}
          resizeOrientation='vertical'
          autoResize
          onChange={(_event, next) => onChange(next)}
        />
      );
    case 'choices': {
      const chosen = Array.isArray(value) ? (value as string[]) : [];
      const options = field.options ?? [];
      const offered = options.map((each) => each.value);

      return (
        <div id={id}>
          {options.map((option) => (
            <Checkbox
              key={option.value}
              id={`${id}_${option.value}`}
              label={i18n._(option.label)}
              isChecked={chosen.includes(option.value)}
              isDisabled={isDisabled}
              onChange={(_event, checked) =>
                // the values stay in the order of the options, so choosing and
                // unchoosing a value leaves the set as it was; a value the
                // options do not name is kept
                onChange([
                  ...offered.filter((each) =>
                    each === option.value ? checked : chosen.includes(each),
                  ),
                  ...chosen.filter((each) => !offered.includes(each)),
                ])
              }
            />
          ))}
        </div>
      );
    }
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
            field.kind === 'integer' || field.kind === 'decimal'
              ? 'number'
              : field.kind === 'url'
                ? 'url'
                : 'text'
          }
          {...(field.kind === 'integer' || field.kind === 'decimal'
            ? {
                min: field.min,
                ...(field.kind === 'decimal' ? { step: 'any' } : {}),
              }
            : {})}
          placeholder={field.placeholder}
          value={String(value ?? '')}
          isRequired={field.required}
          isDisabled={isDisabled}
          validated={validated}
          onChange={(_event, next) => onChange(next)}
        />
      );
  }
};
