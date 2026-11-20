// What the server accepts as a label, so a key or a value is refused on the
// screen exactly when the server would refuse it, and never sooner. A key is
// made of letters, digits, underscores, spaces, dots and hyphens (a name like
// `app.example-name` is a valid key); a value is any text without parentheses.
// Commas are fine in a value: a label expression writes them escaped.

// The characters of a key, with the letters and digits of every script. Built
// from text because the unicode flag of a literal is beyond the compiler's
// target.
export const LABEL_KEY_PATTERN = new RegExp('^[\\p{L}\\p{N}_ .-]+$', 'u');

export type LabelKeyProblem = 'empty' | 'characters';

export type LabelValueProblem = 'parentheses';

// Why a key cannot be used, or null when it can.
export function labelKeyProblem(key: string): LabelKeyProblem | null {
  if (key === '') {
    return 'empty';
  }
  return LABEL_KEY_PATTERN.test(key) ? null : 'characters';
}

// Why a value cannot be used, or null when it can. No value at all is fine.
export function labelValueProblem(value: string): LabelValueProblem | null {
  return /[()]/.test(value) ? 'parentheses' : null;
}
