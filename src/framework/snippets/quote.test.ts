import { describe, expect, it } from 'vitest';
import {
  UnsafeValueError,
  iniValue,
  safeIdentifier,
  tomlString,
  urlValue,
  xmlText,
} from './quote';

const HOSTILE = [
  "x'; rm -rf ~ #",
  'a$(id)`id`',
  'line one\nline two',
  'carriage\rreturn',
  '[section]\nenabled=0',
  '<script>&"</script>',
  'back\\slash "quote"',
];

describe('Unit: quoting for line formats', { tags: ['unit'] }, () => {
  it('keeps a plain value as it is', () => {
    expect(iniValue('Tools mirror 1.0')).toBe('Tools mirror 1.0');
  });

  it.each([
    ['a line feed', 'a\nb'],
    ['a carriage return', 'a\rb'],
    ['a line separator', 'a\u2028b'],
    ['a null byte', 'a\u0000b'],
  ])('refuses %s, which would start another line of the file', (_, value) => {
    expect(() => iniValue(value)).toThrow(UnsafeValueError);
  });

  it('reduces a name to an identifier that is safe in a section header and a file name', () => {
    expect(safeIdentifier('tools-mirror_1.0')).toBe('tools-mirror_1.0');
    expect(safeIdentifier('deb/cust 1')).toBe('deb-cust-1');
    expect(safeIdentifier('x]\n[evil]')).toBe('x-evil');
    expect(safeIdentifier('../../etc/passwd')).toBe('etc-passwd');
    expect(safeIdentifier('a; rm -rf ~')).toBe('a-rm-rf');
    expect(safeIdentifier('')).toBe('pulp');
    expect(safeIdentifier('///')).toBe('pulp');
  });

  it.each(HOSTILE)(
    'leaves no character of %j that could end an identifier line',
    (value) => {
      expect(safeIdentifier(value)).toMatch(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/);
    },
  );

  it('encodes whitespace and the dollar sign of an address, and refuses control characters', () => {
    expect(urlValue('https://x.example/a b/$releasever/')).toBe(
      'https://x.example/a%20b/%24releasever/',
    );
    expect(urlValue('https://x.example/a\nb')).toBe('https://x.example/a%0Ab');
    expect(() => urlValue('https://x.example/a\u0000b')).toThrow(
      UnsafeValueError,
    );
  });
});

describe('Unit: quoting for XML', { tags: ['unit'] }, () => {
  it('escapes the five characters that XML treats as markup', () => {
    expect(xmlText(`<a href="x">&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;',
    );
  });

  it('keeps a line break and a tab', () => {
    expect(xmlText('a\n\tb')).toBe('a\n\tb');
  });

  it('refuses a character XML cannot hold', () => {
    expect(() => xmlText('a\u0001b')).toThrow(UnsafeValueError);
  });

  it.each(HOSTILE)('leaves no markup in %j', (value) => {
    const escaped = xmlText(value);
    expect(escaped).not.toMatch(/[<>"]/);
    expect(escaped.replace(/&(amp|lt|gt|quot|apos);/g, '')).not.toContain('&');
  });
});

describe('Unit: quoting for TOML and JSON strings', { tags: ['unit'] }, () => {
  it('wraps the value in double quotes', () => {
    expect(tomlString('plain')).toBe('"plain"');
  });

  it('escapes quotes, backslashes and line breaks', () => {
    expect(tomlString('a"b\\c\nd\re\tf')).toBe('"a\\"b\\\\c\\nd\\re\\tf"');
  });

  it('writes other control characters as unicode escapes', () => {
    expect(tomlString('a\u0001b\u007fc')).toBe('"a\\u0001b\\u007fc"');
  });

  it.each(HOSTILE)('reads %j back as the same string', (value) => {
    expect(JSON.parse(tomlString(value))).toBe(value);
  });
});
