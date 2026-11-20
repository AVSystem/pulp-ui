import { i18n } from '@lingui/core';
import { Form, FormGroup } from '@patternfly/react-core';
import type { ReactNode } from 'react';
import { Alert, FormFieldHelper, HelpButton } from 'src/components';
import type { RemoteBase } from 'src/entities/plugin/model';
import type { RemoteEntity } from 'src/entities/plugin/remote';
import type { FieldDef } from '../descriptor';
import { FieldInput } from './fields';
import type { FormValues } from './form-values';

interface Props {
  // The fields of the form, in the order they are drawn.
  fields: readonly FieldDef[];
  // What the form holds for each field, by name (see form-values).
  values: FormValues;
  // The server's message for each field it refused, by name.
  errors: Record<string, string>;
  // Fields that are shown but cannot be changed, by name.
  readOnly?: readonly string[];
  // The plugin's remotes, for a field of the kind `remote`.
  remotes?: RemoteEntity<RemoteBase, never, never>;
  // A message that belongs to no field (a refusal, for one), shown in an alert
  // above the actions, and the alert's title.
  failure?: ReactNode;
  failureTitle: string;
  onChange: (name: string, value: unknown) => void;
  // Pressing Enter in a text input sends the form; the screen decides what
  // sending does and guards against sending twice.
  onSubmit: () => void;
  // The actions of the form.
  children?: ReactNode;
}

// A form drawn from the field definitions of a plugin's descriptor: one input
// per field with its label, help and the message the server gave for it. It
// holds no state of its own: the screen owns the values, so what the user typed
// is never replaced by anything the form does.
export const DescriptorForm = ({
  fields,
  values,
  errors,
  readOnly = [],
  remotes,
  failure,
  failureTitle,
  onChange,
  onSubmit,
  children,
}: Props) => (
  <Form
    onSubmit={(event) => {
      event.preventDefault();
      onSubmit();
    }}
  >
    {fields.map((field) => {
      const error = errors[field.name];
      const label = i18n._(field.label);

      return (
        <FormGroup
          key={field.name}
          fieldId={field.name}
          label={
            field.help ? (
              <>
                {label} <HelpButton content={i18n._(field.help)} />
              </>
            ) : (
              label
            )
          }
          isRequired={field.required}
        >
          <FieldInput
            field={field}
            value={values[field.name]}
            hasError={error !== undefined}
            isDisabled={readOnly.includes(field.name)}
            remotes={remotes}
            onChange={(value) => onChange(field.name, value)}
          />
          {error !== undefined ? (
            <FormFieldHelper variant='error'>{error}</FormFieldHelper>
          ) : null}
        </FormGroup>
      );
    })}
    {failure ? (
      <Alert
        variant='danger'
        isInline
        isLiveRegion
        title={failureTitle}
        className='pulp-break-anywhere'
      >
        {failure}
      </Alert>
    ) : null}
    {children}
  </Form>
);
