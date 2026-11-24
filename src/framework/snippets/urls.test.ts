import { describe, expect, it } from 'vitest';
import { snippetInput } from 'src/test-utils/snippets';
import {
  TOKEN_PLACEHOLDER,
  USER_PLACEHOLDER,
  readUrl,
  withCredentials,
  withSlash,
  writeUrl,
} from './urls';

describe('Unit: addresses of snippets', { tags: ['unit'] }, () => {
  it('ends an address with exactly one slash', () => {
    expect(withSlash('https://x.example/a')).toBe('https://x.example/a/');
    expect(withSlash('https://x.example/a/')).toBe('https://x.example/a/');
  });

  it('reads from the entry point when there is one, and from the distribution otherwise', () => {
    expect(readUrl(snippetInput())).toBe(
      'https://pulp.example.com/pulp/content/docs/manuals/',
    );
    expect(
      readUrl(
        snippetInput({
          entry: {
            read: 'https://pulp.example.com/repo/docs',
            write: null,
            signingKey: null,
            suite: null,
            components: null,
          },
        }),
      ),
    ).toBe('https://pulp.example.com/repo/docs/');
  });

  it('never reads from an address that carries credentials', () => {
    expect(
      readUrl(
        snippetInput({ url: 'https://leaked:secret@pulp.example.com/a/' }),
      ),
    ).toBe('https://pulp.example.com/a/');
    expect(
      readUrl(
        snippetInput({
          entry: {
            read: 'https://leaked@pulp.example.com/b/',
            write: null,
            signingKey: null,
            suite: null,
            components: null,
          },
        }),
      ),
    ).toBe('https://pulp.example.com/b/');
  });

  it('writes to the entry point write address when there is one, and to nothing otherwise', () => {
    expect(writeUrl(snippetInput())).toBeNull();
    expect(
      writeUrl(
        snippetInput({
          entry: {
            read: 'https://pulp.example.com/repo/pypi/',
            write: 'https://pulp.example.com/repo/pypi/legacy/',
            signingKey: null,
            suite: null,
            components: null,
          },
        }),
      ),
    ).toBe('https://pulp.example.com/repo/pypi/legacy/');
  });

  it('puts the credential placeholders into an address, and never anything else', () => {
    expect(withCredentials('https://x.example/a/')).toBe(
      `https://${USER_PLACEHOLDER}:${TOKEN_PLACEHOLDER}@x.example/a/`,
    );
    expect(withCredentials('http://x.example/')).toBe(
      `http://${USER_PLACEHOLDER}:${TOKEN_PLACEHOLDER}@x.example/`,
    );
  });

  it('does not add a second set of credentials to an address that carries some', () => {
    expect(withCredentials('https://real:secret@x.example/')).toBe(
      `https://${USER_PLACEHOLDER}:${TOKEN_PLACEHOLDER}@x.example/`,
    );
  });

  it('names the placeholders as the documentation does', () => {
    expect(USER_PLACEHOLDER).toBe('<user>');
    expect(TOKEN_PLACEHOLDER).toBe('<token>');
  });
});
