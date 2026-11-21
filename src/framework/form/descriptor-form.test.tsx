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
    token: { isSet: false, cleared: false, text: '' },
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

  it('draws a list of lines as one text area and a set of choices as one box for each option, and hands the change on in the form of the kind', async () => {
    const kinds: FieldDef[] = [
      { name: 'includes', label: msg`Notes`, kind: 'lines' },
      {
        name: 'types',
        label: msg`Mode`,
        kind: 'choices',
        options: [
          { value: 'fast', label: msg`Fast` },
          { value: 'slow', label: msg`Streamed` },
        ],
      },
    ];
    const changes: [string, unknown][] = [];
    const { user } = renderWithProviders(
      <DescriptorForm
        fields={kinds}
        values={{ includes: 'a\nb', types: ['slow'] }}
        errors={{}}
        failureTitle='Not saved'
        onChange={(name, value) => changes.push([name, value])}
      />,
    );

    expect(screen.getByRole('textbox', { name: /Notes/ })).toHaveValue('a\nb');
    expect(screen.getByRole('checkbox', { name: 'Fast' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Streamed' })).toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: 'Fast' }));
    await user.click(screen.getByRole('checkbox', { name: 'Streamed' }));

    expect(changes).toEqual([
      ['types', ['fast', 'slow']],
      ['types', []],
    ]);
  });

  it('does not send the form, or reload the page, when Enter is pressed in its only text input', async () => {
    const single: FieldDef[] = [
      { name: 'name', label: msg`Name`, kind: 'text' },
    ];
    const submitted: boolean[] = [];
    const { user, container } = renderWithProviders(
      <DescriptorForm
        fields={single}
        values={{ name: 'tools' }}
        errors={{}}
        failureTitle='Not saved'
        onChange={() => undefined}
      />,
    );
    // seen after the form's own handler, which runs on the way up
    container.addEventListener('submit', (event) =>
      submitted.push(event.defaultPrevented),
    );

    await user.type(screen.getByRole('textbox', { name: /Name/ }), '{Enter}');

    expect(submitted).toEqual([true]);
  });
});
