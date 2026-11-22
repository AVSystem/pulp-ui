import { t } from '@lingui/core/macro';
import { FormGroup, Radio } from '@patternfly/react-core';
import { useState } from 'react';
import { FormFieldHelper, HelpButton } from 'src/components';
import { GuardField } from './guard-field';

// How a distribution is protected, as the user has chosen it: the content guard
// that is picked, Public, or null while nothing is decided. A guard that is
// asked for but not yet picked is also null, so the form never counts it as a
// choice.
export type Protection = { guard: string } | 'public' | null;

// A protection that was decided.
export type Chosen = Exclude<Protection, null>;

// The content guard a decided protection puts on a distribution: the address of
// the picked guard, or null, which means no guard, for Public and for nothing
// else. A protection that is not decided has no content guard to send, and
// asking for one is a mistake in the caller, never a way to make a
// distribution public.
export function contentGuardOf(protection: Chosen): string | null {
  if (protection === 'public') {
    return null;
  }
  if (protection && typeof protection === 'object' && protection.guard) {
    return protection.guard;
  }
  throw new Error('The protection of the distribution is not chosen');
}

interface Props {
  value: Protection;
  onChange: (value: Protection) => void;
  isDisabled?: boolean;
}

// The choice between protecting a distribution with a content guard and making
// it public. Neither is chosen at the start and nothing here defaults to
// either: a distribution becomes public only because someone chose Public.
// Choosing Protected reports no decision until a guard is picked.
export const ProtectionChoice = ({ value, onChange, isDisabled }: Props) => {
  // Protected is chosen but no guard is picked yet.
  const [picking, setPicking] = useState(false);
  const mode =
    value === 'public' ? 'public' : value !== null || picking ? 'guard' : null;
  const guard = value !== null && value !== 'public' ? value.guard : null;

  return (
    <FormGroup
      fieldId='protection'
      role='radiogroup'
      isStack
      isRequired
      label={
        <>
          {t`Protection`}{' '}
          <HelpButton
            content={t`A content guard limits who can download. A public distribution has no content guard, so anyone who can reach the server can download from it.`}
          />
        </>
      }
    >
      <Radio
        id='protection_guard'
        name='protection'
        label={t`Protected by a content guard`}
        description={t`Only clients the guard allows can download.`}
        isChecked={mode === 'guard'}
        isDisabled={isDisabled}
        onChange={() => {
          setPicking(true);
          onChange(null);
        }}
        body={
          mode === 'guard' ? (
            <GuardField
              value={guard}
              isDisabled={isDisabled}
              onChange={(href) => onChange(href ? { guard: href } : null)}
            />
          ) : undefined
        }
      />
      <Radio
        id='protection_public'
        name='protection'
        label={t`Public - anyone can download without signing in`}
        isChecked={mode === 'public'}
        isDisabled={isDisabled}
        onChange={() => {
          setPicking(false);
          onChange('public');
        }}
        body={
          mode === 'public' ? (
            <FormFieldHelper variant='warning'>
              {t`The distribution will have no content guard: anyone who can reach this server can download its content without signing in.`}
            </FormFieldHelper>
          ) : undefined
        }
      />
      {mode === null ? (
        <FormFieldHelper>
          {t`Choose how this distribution is protected.`}
        </FormFieldHelper>
      ) : null}
    </FormGroup>
  );
};
