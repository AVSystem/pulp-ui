// Quoting of values for the text formats a client snippet is written in.
// Shell words are quoted by `shellQuote`; the helpers here cover the formats a
// shell quote does not: line-oriented files (INI, DEB822, netrc), XML and TOML
// or JSON strings. Every value that comes from the server or from a user goes
// through one of them, because the snippet is pasted into a terminal or a
// configuration file.

// A value that cannot be written into the format without changing what the file
// says, for instance a line break in a value of a line-oriented file. The panel
// shows the snippet as unavailable instead of writing it.
export class UnsafeValueError extends Error {
  constructor(what: string) {
    super(what);
    this.name = 'UnsafeValueError';
  }
}

// Characters that end a line or cannot sit in a line of text at all.
// The control characters are what the pattern is for.
// eslint-disable-next-line no-control-regex
const LINE_BREAKS_AND_CONTROLS = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/;

// A value of a line-oriented file (INI key, DEB822 field, netrc word). It is
// returned as it is when it holds nothing that would start another line, and
// refused otherwise: there is no escape that every reader of these formats
// understands.
export function iniValue(value: string): string {
  if (LINE_BREAKS_AND_CONTROLS.test(value)) {
    throw new UnsafeValueError('a line break or control character');
  }

  return value;
}

// A name reduced to what is safe in a section header and in a file name: letters,
// digits, dot, underscore and hyphen, starting with a letter or digit. Anything
// else becomes a hyphen, so a name cannot close the header, start another
// section or climb out of a directory.
export function safeIdentifier(value: string): string {
  const reduced = value
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/-+$/, '');

  return reduced === '' ? 'pulp' : reduced;
}

// An address written into a line-oriented file: whitespace and the dollar sign
// (which package managers expand as a variable) are percent-encoded, which an
// address allows, and control characters are refused.
export function urlValue(value: string): string {
  return iniValue(
    value.replace(/[\s$]/g, (character) => encodeURIComponent(character)),
  );
}

// Characters XML 1.0 cannot hold, even escaped.
// eslint-disable-next-line no-control-regex
const NOT_IN_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/;

// Text between tags or inside an attribute of an XML file.
export function xmlText(value: string): string {
  if (NOT_IN_XML.test(value)) {
    throw new UnsafeValueError('a control character');
  }

  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const SHORT_ESCAPES: Record<string, string> = {
  '"': '\\"',
  '\\': '\\\\',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\b': '\\b',
  '\f': '\\f',
};

// A TOML basic string, which is also a valid JSON string: wrapped in double
// quotes, with quote, backslash and control characters escaped.
export function tomlString(value: string): string {
  const escaped = value.replace(
    // eslint-disable-next-line no-control-regex
    /["\\\u0000-\u001f\u007f]/g,
    (character) =>
      SHORT_ESCAPES[character] ??
      `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );

  return `"${escaped}"`;
}
