import { validateURLHelper } from 'src/utilities/validate-url-helper';
import type { FieldDef } from '../descriptor';
import { labelKeyProblem, labelValueProblem } from '../labels/label-rules';

// How the fields of a descriptor's form hold their values while the form is
// open, and how those values become the body of a request. A form holds what
// an input shows (the text of a number, the rows of the labels) so that what
// the user types is never rewritten under them; the request holds what the
// server takes.
export type FormValues = Record<string, unknown>;

// One label as the form holds it: a key and a value, which is empty for a label
// with no value.
export interface LabelRow {
  key: string;
  value: string;
}

// A secret field as the form holds it. The server never returns a secret, only
// whether one is stored, so the form holds that, whether the user pressed Clear,
// and what the user typed. Nothing the server stored is ever in the form.
export interface SecretValue {
  // A value is stored on the server (from the remote's hidden fields).
  isSet: boolean;
  // The user asked for the stored value to be removed.
  cleared: boolean;
  // What the user typed; empty when nothing was.
  text: string;
}

// A label key or value the server would refuse, or a key used twice (the
// second would silently replace the first).
export type LabelProblem = 'empty' | 'characters' | 'parentheses' | 'duplicate';

// A value of a field the server would refuse, or one the form cannot turn into
// a request: a number that is not a number, a whole number with a fraction,
// a number under the field's minimum, a URL that is not http or https.
export type FieldProblem = 'number' | 'whole' | 'min' | 'url';

const text = (value: unknown): string =>
  typeof value === 'string' ? value : '';

// The texts of a list the server sent, and none for anything else.
const textsOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];

// The values of a set of choices that are chosen, in the order of the options,
// followed by any the options do not name: a value a later server adds is kept
// and sent back as it was, never dropped by an edit that did not touch it.
function chosenOf(field: FieldDef, value: unknown): string[] {
  const chosen = textsOf(value);
  const offered = (field.options ?? []).map((option) => option.value);

  return [
    ...offered.filter((option) => chosen.includes(option)),
    ...chosen.filter((option) => !offered.includes(option)),
  ];
}

// Whether the field is one the server keeps and never returns.
export const isSecret = (field: FieldDef): boolean =>
  field.kind === 'secret' || field.secret === true;

// What a form holds for a field of the object as it was read.
function formValue(
  field: FieldDef,
  value: unknown,
  source: Record<string, unknown>,
): unknown {
  if (isSecret(field)) {
    const hidden = Array.isArray(source['hidden_fields'])
      ? (source['hidden_fields'] as { name?: unknown; is_set?: unknown }[])
      : [];
    const secret: SecretValue = {
      isSet: hidden.some(
        ({ name, is_set }) => name === field.name && is_set === true,
      ),
      cleared: false,
      text: '',
    };
    return secret;
  }

  switch (field.kind) {
    case 'integer':
    case 'decimal':
      return typeof value === 'number' && value !== field.blankValue
        ? String(value)
        : '';
    case 'boolean':
      return value === true;
    case 'labels':
      return Object.entries((value ?? {}) as Record<string, string | null>).map(
        ([key, labelValue]): LabelRow => ({
          key,
          value: labelValue ?? '',
        }),
      );
    case 'remote':
      return typeof value === 'string' && value !== '' ? value : null;
    case 'lines':
      return textsOf(value).join('\n');
    case 'choices':
      return chosenOf(field, value);
    default:
      return text(value);
  }
}

// The values of every field, from the object the screen read.
export function toForm(
  fields: readonly FieldDef[],
  source: Record<string, unknown>,
): FormValues {
  return Object.fromEntries(
    fields.map((field) => [
      field.name,
      formValue(field, source[field.name], source),
    ]),
  );
}

// A row nobody has typed into is not a label.
const isBlank = ({ key, value }: LabelRow) => key === '' && value === '';

// What a request sends for a form value. An empty text stays empty here: the
// comparison with the stored object turns it into null where that is a change.
function requestValue(field: FieldDef, value: unknown): unknown {
  if (isSecret(field)) {
    // A secret is sent only when something was typed or the stored value was
    // cleared; anything else says nothing about it.
    const { text: typed, cleared } = value as SecretValue;
    if (typed !== '') {
      return typed;
    }
    return cleared ? null : undefined;
  }

  switch (field.kind) {
    case 'integer':
    case 'decimal': {
      const digits = text(value).trim();
      return digits === '' ? (field.blankValue ?? null) : Number(digits);
    }
    case 'lines':
      // One item for each line that holds something: a blank line and the
      // spaces around an item are not part of it.
      return text(value)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '');
    case 'choices':
      return textsOf(value);
    case 'labels':
      return Object.fromEntries(
        (value as LabelRow[])
          .filter((row) => !isBlank(row))
          .map(({ key, value: labelValue }) => [
            key,
            labelValue === '' ? null : labelValue,
          ]),
      );
    default:
      return value;
  }
}

// The names of the fields whose value in `after` is not the one in `before`, as
// the form holds them.
export function changedNames(
  fields: readonly FieldDef[],
  before: FormValues,
  after: FormValues,
): string[] {
  return fields
    .filter(
      ({ name }) =>
        JSON.stringify(before[name]) !== JSON.stringify(after[name]),
    )
    .map(({ name }) => name);
}

// The request values of the named fields. A secret nobody typed into or cleared
// has no request value and is left out.
export function toRequest(
  fields: readonly FieldDef[],
  values: FormValues,
  names: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    fields
      .filter(({ name }) => names.includes(name))
      .map((field): [string, unknown] => [
        field.name,
        requestValue(field, values[field.name]),
      ])
      .filter(([, value]) => value !== undefined),
  );
}

// The kinds whose empty text is no value: a create sends null for them, so the
// server is not told that a description is the empty string.
const TEXT_KINDS: readonly FieldDef['kind'][] = [
  'text',
  'textarea',
  'url',
  'certificate',
  'select',
];

// The body of a create: the request value of every field, with null for a text
// that was left empty. A blank number is null too (keep everything), and the
// labels are an object. Nothing here changes what the user typed.
export function toCreateBody(
  fields: readonly FieldDef[],
  values: FormValues,
): Record<string, unknown> {
  const body = toRequest(
    fields,
    values,
    fields.map(({ name }) => name),
  );

  for (const { name, kind } of fields) {
    if (TEXT_KINDS.includes(kind) && body[name] === '') {
      body[name] = null;
    }
  }

  return body;
}

// Why the label of this row cannot be sent, or null when it can.
export function labelProblem(
  rows: readonly LabelRow[],
  index: number,
): LabelProblem | null {
  const row = rows[index];
  if (isBlank(row)) {
    return null;
  }
  const key = labelKeyProblem(row.key);
  if (key) {
    return key;
  }
  if (labelValueProblem(row.value)) {
    return 'parentheses';
  }
  return rows.some((other, at) => at < index && other.key === row.key)
    ? 'duplicate'
    : null;
}

// The body of a create that sends only what was filled in: a field left empty,
// a number left blank, a secret nobody typed, labels with no rows and a list or
// a set with no item are not sent at all, so the server applies its own default for each and is never told
// that a username is the empty string. A box that is unticked and the number 0
// are values and are sent.
export function toFilledBody(
  fields: readonly FieldDef[],
  values: FormValues,
): Record<string, unknown> {
  const body = toRequest(
    fields,
    values,
    fields.map(({ name }) => name),
  );

  return Object.fromEntries(
    Object.entries(body).filter(([, value]) => {
      if (value === null || value === '') {
        return false;
      }
      if (Array.isArray(value) && value.length === 0) {
        return false;
      }
      return !(
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.keys(value).length === 0
      );
    }),
  );
}

// What is wrong with the value of a field, or null when nothing is. Only a
// field that declares a minimum has its numbers checked (every other number is
// left to the server), and a URL is checked when something was typed.
export function fieldProblem(
  field: FieldDef,
  value: unknown,
): FieldProblem | null {
  if (field.kind === 'url') {
    const url = text(value).trim();
    return url !== '' && validateURLHelper(undefined, url).variant === 'error'
      ? 'url'
      : null;
  }

  if (
    field.min === undefined ||
    (field.kind !== 'integer' && field.kind !== 'decimal')
  ) {
    return null;
  }
  const digits = text(value).trim();
  if (digits === '') {
    return null;
  }
  const number = Number(digits);
  if (Number.isNaN(number)) {
    return 'number';
  }
  if (field.kind === 'integer' && !Number.isInteger(number)) {
    return 'whole';
  }
  return number < field.min ? 'min' : null;
}

// The kinds whose value is a text that can be empty, which a required field of
// that kind must not be. A box is never missing (unticked is an answer), and a
// secret, the labels and a remote are never required of a plugin.
const TEXT_VALUED_KINDS: readonly FieldDef['kind'][] = [
  'text',
  'textarea',
  'url',
  'certificate',
  'select',
  'integer',
  'decimal',
];

// Whether a required field holds nothing, or only spaces: the server refuses
// such a request, so the form keeps Save off instead of sending it.
export function missingRequired(
  fields: readonly FieldDef[],
  values: FormValues,
): boolean {
  return fields.some(
    (field) =>
      field.required === true &&
      !isSecret(field) &&
      TEXT_VALUED_KINDS.includes(field.kind) &&
      text(values[field.name]).trim() === '',
  );
}

// Whether a value of the form is one the server would refuse, so the form does
// not send what it knows to fail.
export function hasProblems(
  fields: readonly FieldDef[],
  values: FormValues,
): boolean {
  return missingRequired(fields, values) || hasInvalidValue(fields, values);
}

function hasInvalidValue(
  fields: readonly FieldDef[],
  values: FormValues,
): boolean {
  return fields.some(
    (field) =>
      fieldProblem(field, values[field.name]) !== null ||
      (field.kind === 'labels' &&
        (values[field.name] as LabelRow[]).some(
          (_row, index) =>
            labelProblem(values[field.name] as LabelRow[], index) !== null,
        )),
  );
}
