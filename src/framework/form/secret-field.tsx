import { t } from '@lingui/core/macro';
import {
  Button,
  InputGroup,
  InputGroupItem,
  TextInput,
} from '@patternfly/react-core';
import type { ReactNode } from 'react';
import { FormFieldHelper } from 'src/components';
import type { SecretValue } from './form-values';

interface Props {
  id: string;
  value: SecretValue;
  onChange: (value: SecretValue) => void;
  isDisabled: boolean;
  hasError: boolean;
  // What the field is called where it is announced, for the buttons.
  label: string;
  // The input for a new value. The default is a masked text input; a field
  // whose value is a longer text (a key) draws its own.
  input?: (props: {
    id: string;
    text: string;
    onText: (text: string) => void;
  }) => ReactNode;
}

// A field whose value the server keeps and never returns (a password, a key).
// While a value is stored the field says so and offers to clear it, and shows
// nothing of the value: it is never prefilled, so it cannot be copied from the
// page or changed by accident. After Clear, or when nothing is stored, the field
// takes a new value. What is typed lives in the form and nowhere else: not in
// the address, not in the browser's storage.
export const SecretField = ({
  id,
  value,
  onChange,
  isDisabled,
  hasError,
  label,
  input,
}: Props) => {
  const onText = (text: string) => onChange({ ...value, text });

  if (value.isSet && !value.cleared) {
    return (
      <InputGroup>
        <InputGroupItem isFill>
          <TextInput
            id={id}
            type='text'
            value={t`Is set`}
            readOnly
            isDisabled
            aria-label={label}
          />
        </InputGroupItem>
        <InputGroupItem>
          <Button
            variant='control'
            isDisabled={isDisabled}
            aria-label={t`Clear ${label}`}
            onClick={() => onChange({ ...value, cleared: true, text: '' })}
          >
            {t`Clear`}
          </Button>
        </InputGroupItem>
      </InputGroup>
    );
  }

  return (
    <>
      {input ? (
        input({ id, text: value.text, onText })
      ) : (
        <TextInput
          id={id}
          type='password'
          autoComplete='off'
          value={value.text}
          isDisabled={isDisabled}
          validated={hasError ? 'error' : 'default'}
          onChange={(_event, text) => onText(text)}
        />
      )}
      {value.isSet ? (
        <FormFieldHelper>
          {value.text === ''
            ? t`The stored value is removed when you save.`
            : t`The stored value is replaced when you save.`}{' '}
          <Button
            variant='link'
            isInline
            isDisabled={isDisabled}
            aria-label={t`Keep the stored ${label}`}
            onClick={() => onChange({ ...value, cleared: false, text: '' })}
          >
            {t`Keep it`}
          </Button>
        </FormFieldHelper>
      ) : null}
    </>
  );
};
