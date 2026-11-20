import { LABEL_KEY_PATTERN } from './label-rules';

// The `pulp_label_select` filter of the server. An expression is a list of
// terms joined by commas and a row must satisfy every term:
//
//   key=value   the label has this key with this value
//   key         the label has this key
//   !key        the object has no label with this key
//
// (the server also reads `key!=value` and `key~part`; the screens write only
// the three above, and the advanced input passes anything else through). A
// comma that is part of a value is written `\,`, and the server splits only at
// commas that are not escaped.

// One condition of the structured filter.
export interface LabelRow {
  key: string;
  // No value (undefined or null) asks only for the key; a text, even an empty
  // one, asks for that value.
  value?: string | null;
  // The key must not be set; any value is ignored.
  absent?: boolean;
}

// The expression for rows, in order. A row without a key is left out, and no
// row at all is the empty expression.
export function labelSelect(rows: readonly LabelRow[]): string {
  return rows
    .flatMap((row) => {
      const key = row.key.trim();
      if (key === '') {
        return [];
      }
      if (row.absent) {
        return [`!${key}`];
      }
      return [
        row.value === undefined || row.value === null
          ? key
          : `${key}=${row.value.replace(/,/g, '\\,')}`,
      ];
    })
    .join(',');
}

// The terms of an expression: the pieces between commas that are not escaped.
// An empty or missing expression has none.
export function splitTerms(expression: string | undefined): string[] {
  if (!expression) {
    return [];
  }

  const terms: string[] = [];
  let current = '';
  for (let at = 0; at < expression.length; at += 1) {
    const char = expression.charAt(at);
    if (char === ',' && expression.charAt(at - 1) !== '\\') {
      terms.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  terms.push(current);

  return terms;
}

// The expression of terms, or nothing when there are none.
export function joinTerms(terms: readonly string[]): string | undefined {
  return terms.length > 0 ? terms.join(',') : undefined;
}

const TERM = new RegExp(
  `^(!?)(${LABEL_KEY_PATTERN.source.slice(1, -1)})(?:=(.*))?$`,
  'su',
);

// The rows an expression stands for, when it holds only `key=value`, `key` and
// `!key` terms; null for anything else (another operator, an empty term, a key
// the server does not take), which only the text of the advanced input can
// show without losing its meaning.
export function parseLabelSelect(expression: string): LabelRow[] | null {
  const rows: LabelRow[] = [];

  for (const term of splitTerms(expression)) {
    const found = TERM.exec(term);
    if (!found) {
      return null;
    }
    const [, bang, key = '', value] = found;
    if (bang) {
      if (value !== undefined) {
        return null;
      }
      rows.push({ key, absent: true });
    } else if (value === undefined) {
      rows.push({ key });
    } else {
      rows.push({ key, value: value.replace(/\\,/g, ',') });
    }
  }

  return rows;
}

// The keys of the labels the objects carry, each once, in alphabetical order:
// what a key input suggests.
export function labelKeysOf(
  objects: readonly { pulp_labels?: Record<string, unknown> | null }[],
): string[] {
  const keys = new Set<string>();
  for (const object of objects) {
    for (const key of Object.keys(object.pulp_labels ?? {})) {
      keys.add(key);
    }
  }

  return Array.from(keys).sort((a, b) => a.localeCompare(b));
}
