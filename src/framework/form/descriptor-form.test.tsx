import { msg } from '@lingui/core/macro';
import { screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import type { FieldDef } from '../descriptor';
import { DescriptorForm } from './descriptor-form';
import type { FormValues } from './form-values';

const fields: FieldDef[] = [
  { name: 'name', label: msg`Name`, kind: 'text', required: true },
  {
    name: 'mode',
    label: msg`Mode`,
    kind: 'select',
    options: [{ value: 'fast', label: msg`Fast` }],
  },
  {
    name: 'notes',
    label: msg`Notes`,
    kind: 'textarea',
    help: msg`Free text.`,
  },
  {
    name: 'token',
    label: msg`Token`,
    kind: 'secret',
  },
  {
    name: 'colour',
    label: msg`Colour`,
    kind: 'text',
    widget: ({ id, value, onChange }) => (
      <button type='button' id={id} onClick={() => onChange('green')}>
        {`Colour is ${String(value)}`}
      </button>
    ),
  },
];

function Harness({ errors = {} }: { errors?: Record<string, string> }) {
  const [values, setValues] = useState<FormValues>({
    name: 'tools',
    mode: '',
    notes: '',
    token: '',
    colour: 'red',
  });

  return (
    <DescriptorForm
      fields={fields}
      values={values}
      errors={errors}
      readOnly={['name']}
      failureTitle='Not saved'
      onChange={(name, value) =>
        setValues((now) => ({ ...now, [name]: value }))
      }
      onSubmit={() => undefined}
    />
  );
}

describe('Integration: DescriptorForm', { tags: ['integration'] }, () => {
  it('draws an input of each kind, marks the required and the read-only field and hands a value to the plugin widget', async () => {
    const { user } = renderWithProviders(<Harness />);

    const name = screen.getByRole('textbox', { name: /Name/ });
    expect(name).toBeDisabled();
    expect(name).toBeRequired();
    expect(screen.getByLabelText('Token')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('combobox', { name: /Mode/ })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Notes/ })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'More information' }),
    ).toBeVisible();

    await user.click(screen.getByText('Colour is red'));
    expect(screen.getByText('Colour is green')).toBeInTheDocument();
  });

  it('shows the message of the server under the field it names', () => {
    renderWithProviders(<Harness errors={{ notes: 'Too long.' }} />);

    expect(screen.getByText('Too long.')).toBeInTheDocument();
  });
});
