import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { ExpandableSection, Form, FormGroup } from '@patternfly/react-core';
import formStyles from '@patternfly/react-styles/css/components/Form/form.mjs';
import { type ReactNode, useState } from 'react';
import { Alert, FormFieldHelper, HelpButton } from 'src/components';
import type { RemoteBase } from 'src/entities/plugin/model';
import type { RemoteEntity } from 'src/entities/plugin/remote';
import type { FieldDef } from '../descriptor';
import { FieldInput } from './fields';
import {
  type FieldProblem,
  type FormValues,
  fieldProblem,
} from './form-values';

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
  // What follows the fields and precedes the failure: a part of the form that
  // is not a field of the descriptor.
  extra?: ReactNode;
  onChange: (name: string, value: unknown) => void;
  // Pressing Enter in a text input sends the form; the screen decides what
  // sending does and guards against sending twice.
  onSubmit: () => void;
  // The actions of the form.
  children?: ReactNode;
}

// What a value the form cannot send is called, next to its input.
function problemText(problem: FieldProblem, field: FieldDef): string {
  switch (problem) {
    case 'number':
      return t`Enter a number.`;
    case 'whole':
      return t`Enter a whole number.`;
    case 'min':
      return t`Enter ${field.min} or more.`;
    case 'url':
      return t`The URL needs to be in 'http(s)://' format.`;
  }
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
  extra,
  onChange,
  onSubmit,
  children,
}: Props) => {
  // The advanced options are folded away until the user opens them, and open on
  // their own when the server refused one of them: a message in a folded part
  // of the form would never be seen.
  const [open, setOpen] = useState(false);
  const basic = fields.filter((field) => !field.advanced);
  const advanced = fields.filter((field) => field.advanced);
  const advancedRefused = advanced.some(
    ({ name }) => errors[name] !== undefined,
  );

  const drawField = (field: FieldDef) => {
    const problem = fieldProblem(field, values[field.name]);
    const error =
      errors[field.name] ??
      (problem === null ? undefined : problemText(problem, field));
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
        role={field.kind === 'choices' ? 'group' : undefined}
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
        ) : field.hint ? (
          <FormFieldHelper>{i18n._(field.hint)}</FormFieldHelper>
        ) : null}
      </FormGroup>
    );
  };

  return (
    <Form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {basic.map(drawField)}
      {advanced.length > 0 ? (
        <ExpandableSection
          toggleTextExpanded={t`Hide advanced options`}
          toggleTextCollapsed={t`Show advanced options`}
          isExpanded={open || advancedRefused}
          onToggle={(_event, expanded) => setOpen(expanded)}
        >
          <div className={formStyles.form}>{advanced.map(drawField)}</div>
        </ExpandableSection>
      ) : null}
      {extra}
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
};
