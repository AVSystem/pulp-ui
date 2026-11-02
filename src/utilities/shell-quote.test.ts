import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { debRemoteCommand } from 'src/containers/deb-repository/tab-distributions';
import { fileRemoteCommand } from 'src/containers/file-repository/tab-distributions';
import { pipInstallCommand } from 'src/containers/python-repository/tab-distributions';
import { rpmRemoteCommand } from 'src/containers/rpm-repository/tab-distributions';
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

// A repository name is free text and the URL comes from the server, so every
// copy-paste command of the Distributions tabs quotes each value it holds.
describe('Distributions tab commands', () => {
  const hostile = "a$(id)'b`id`";
  const quotedHostile = "'a$(id)'\\''b`id`'";
  const url = 'https://pulp.example/pulp/content/served/tools/';

  it.each([
    [
      'file',
      fileRemoteCommand(hostile, url),
      `pulp file remote create --name ${quotedHostile} --url '${url}PULP_MANIFEST'`,
    ],
    [
      'deb',
      debRemoteCommand(hostile, url),
      `pulp deb remote create --name ${quotedHostile} --url '${url}' --distributions '<suite>'`,
    ],
    [
      'rpm',
      rpmRemoteCommand(hostile, url),
      `pulp rpm remote create --name ${quotedHostile} --url '${url}'`,
    ],
    [
      'python',
      pipInstallCommand("https://pulp.example/a$(id)'b/"),
      "pip install --index-url 'https://pulp.example/a$(id)'\\''b/simple/' <package>",
    ],
  ])(
    'quotes the name and URL of the %s command',
    (_plugin, actual, expected) => {
      expect(actual).toBe(expected);
    },
  );

  it('adds the missing slash before the simple index of a python distribution', () => {
    expect(pipInstallCommand('https://pulp.example/x')).toBe(
      "pip install --index-url 'https://pulp.example/x/simple/' <package>",
    );
  });
});
