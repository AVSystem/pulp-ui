import { t } from '@lingui/core/macro';
import { Content, FormGroup, TextInput } from '@patternfly/react-core';
import { FormFieldHelper } from 'src/components';
import { BasePathHelp } from '../form/distribution-option';
import type { SaveFailure } from '../form/save-errors';

// The parts the create and the edit form of a distribution have in common.

// The fields the server may name in a refusal and the forms show a message
// under.
export const SHOWN_FIELDS = ['name', 'base_path', 'repository', 'publication'];

// The failure of a save without the messages of the given fields: a message
// stays under a value only until the value is edited.
export function withoutMessagesOf(
  failure: SaveFailure | null,
  fields: readonly string[],
): SaveFailure | null {
  if (!failure || !fields.some((field) => field in failure.fields)) {
    return failure;
  }

  return {
    ...failure,
    fields: Object.fromEntries(
      Object.entries(failure.fields).filter(([key]) => !fields.includes(key)),
    ),
  };
}

// The note that replaces the protection choice where the plugin gives each
// distribution its own content guard and refuses any other.
export const ServerManagedGuard = ({ created }: { created: boolean }) => (
  <FormGroup label={t`Protection`} fieldId='protection'>
    <Content component='p'>
      {created
        ? t`The server manages the content guard of this distribution. It is set when the distribution is created and cannot be chosen here.`
        : t`The server manages the content guard of this distribution. It cannot be changed here.`}
    </Content>
  </FormGroup>
);

interface BasePathProps {
  value: string;
  onChange: (value: string) => void;
  // The reason the path cannot be used, in words, or null.
  message: string | null;
  // The message of the server or of the check for the base path.
  error?: string;
}

// The base path with the reason it is refused and a preview of the address it
// is served under.
export const BasePathGroup = ({
  value,
  onChange,
  message,
  error,
}: BasePathProps) => (
  <FormGroup label={t`Base path`} fieldId='base_path' isRequired>
    <TextInput
      id='base_path'
      isRequired
      type='text'
      value={value}
      validated={message || error ? 'error' : 'default'}
      onChange={(_event, next) => onChange(next)}
    />
    <BasePathHelp basePath={value} message={message ?? error ?? null} />
  </FormGroup>
);

// The name of the distribution, drawn read-only on the edit form: a
// distribution is not renamed there, because its address names it.
export const NameGroup = ({
  value,
  onChange,
  error,
  readOnly,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  readOnly?: boolean;
}) => (
  <FormGroup label={t`Name`} fieldId='name' isRequired>
    <TextInput
      id='name'
      isRequired
      type='text'
      value={value}
      isDisabled={readOnly}
      validated={error ? 'error' : 'default'}
      onChange={(_event, next) => onChange(next)}
    />
    {error ? <FormFieldHelper variant='error'>{error}</FormFieldHelper> : null}
  </FormGroup>
);
