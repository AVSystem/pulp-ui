import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { shellQuote } from './shell-quote';

// What a POSIX shell makes of the quoted word, printed as raw bytes.
const throughShell = (value: string): string =>
  execFileSync('/bin/sh', ['-c', `printf %s ${shellQuote(value)}`], {
    encoding: 'utf8',
  });

describe('shellQuote', () => {
  it('wraps a plain value in single quotes', () => {
    expect(shellQuote('plain')).toBe("'plain'");
  });

  it('turns the empty string into an empty quoted word', () => {
    expect(shellQuote('')).toBe("''");
  });

  it('closes, escapes and reopens the quotes around a single quote', () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });

  it('keeps command substitution, backticks, spaces and double quotes inside the quotes', () => {
    expect(shellQuote('a$(id) `id` "b" c')).toBe('\'a$(id) `id` "b" c\'');
  });

  it.each([
    ['a plain name', 'plain'],
    ['a single quote', "it's"],
    ['command substitution', 'a$(touch /nonexistent/x)b'],
    ['backticks', 'a`touch /nonexistent/x`b'],
    ['a space and a semicolon', 'a b; touch /nonexistent/x'],
    ['double quotes and a dollar sign', 'say "$HOME"'],
    ['a newline', 'line1\nline2; touch /nonexistent/x'],
    ['a backslash', 'a\\b\\'],
    ['all of them together', 'a$(id)\'b`id`"c"\nd\\'],
    ['only quotes', "'''"],
    ['the empty string', ''],
  ])('reaches the shell as exactly the same data for %s', (_label, value) => {
    expect(throughShell(value)).toBe(value);
  });
});
