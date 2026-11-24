import { describe, expect, it } from 'vitest';
import type { SnippetDef } from 'src/framework/descriptor';
import { shellWords, snippetInput } from 'src/test-utils/snippets';
import { fileSnippets } from './snippets';

const snippet = (id: string): SnippetDef => {
  const found = fileSnippets.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`no file snippet ${id}`);
  }
  return found;
};

const URL_DOCS = 'https://pulp.example.com/pulp/content/docs/manuals/';

describe('Unit: file client snippets', { tags: ['unit'] }, () => {
  it('offers curl, wget and the pulp command line, in that order', () => {
    expect(fileSnippets.map(({ id }) => id)).toEqual([
      'curl',
      'wget',
      'pulp-cli',
    ]);
    expect(fileSnippets.map(({ language }) => language)).toEqual([
      'shell',
      'shell',
      'shell',
    ]);
  });

  describe('of a public distribution', () => {
    it('downloads a file with curl and with wget', () => {
      expect(snippet('curl').build(snippetInput())).toBe(
        `curl -fSLO '${URL_DOCS}<path>'`,
      );
      expect(snippet('wget').build(snippetInput())).toBe(
        `wget '${URL_DOCS}<path>'`,
      );
    });

    it('asks for no credentials', () => {
      for (const id of ['curl', 'wget']) {
        expect(snippet(id).build(snippetInput())).not.toMatch(/user|token/);
      }
    });

    it('writes the pulp command for the manifest, with the repository name', () => {
      expect(snippet('pulp-cli').build(snippetInput())).toBe(
        `pulp file remote create --name 'manuals-repo' --url '${URL_DOCS}PULP_MANIFEST'`,
      );
    });

    it('names the remote after the distribution when the repository is not known', () => {
      expect(
        snippet('pulp-cli').build(snippetInput({ repositoryName: null })),
      ).toBe(
        `pulp file remote create --name 'manuals' --url '${URL_DOCS}PULP_MANIFEST'`,
      );
    });
  });

  describe('of a guarded distribution', () => {
    const guarded = snippetInput({ guarded: true });

    it('sends the placeholders and nothing else as credentials', () => {
      expect(snippet('curl').build(guarded)).toBe(
        `curl -fSLO -u '<user>:<token>' '${URL_DOCS}<path>'`,
      );
      expect(snippet('wget').build(guarded)).toBe(
        `wget --user '<user>' --ask-password '${URL_DOCS}<path>'`,
      );
    });
  });

  describe('with an entry point', () => {
    it('reads from the entry point address, not from the distribution address', () => {
      const entry = {
        read: 'https://files.example.org/docs/',
        write: null,
        signingKey: null,
        suite: null,
        components: null,
      };

      expect(snippet('curl').build(snippetInput({ entry }))).toBe(
        "curl -fSLO 'https://files.example.org/docs/<path>'",
      );
      expect(snippet('pulp-cli').build(snippetInput({ entry }))).toBe(
        "pulp file remote create --name 'manuals-repo' --url 'https://files.example.org/docs/PULP_MANIFEST'",
      );
    });
  });

  describe('with hostile values', () => {
    const hostileName = "x'; rm -rf ~ #\n$(id)`id`";
    const hostileUrl = "https://pulp.example.com/a'; rm -rf ~ #/$(id)/`id`/\n";
    const input = snippetInput({
      name: hostileName,
      repositoryName: hostileName,
      url: hostileUrl,
    });

    it('hands the shell one word for the address of each line', () => {
      expect(
        shellWords(
          snippet('curl')
            .build(input)
            .replace(/^curl /, ''),
        ),
      ).toEqual(['-fSLO', `${withSlash(hostileUrl)}<path>`]);
      expect(
        shellWords(
          snippet('wget')
            .build(input)
            .replace(/^wget /, ''),
        ),
      ).toEqual([`${withSlash(hostileUrl)}<path>`]);
    });

    it('hands the shell the hostile name as one word of data', () => {
      expect(
        shellWords(
          snippet('pulp-cli')
            .build(input)
            .replace(/^pulp file remote create /, ''),
        ),
      ).toEqual([
        '--name',
        hostileName,
        '--url',
        `${withSlash(hostileUrl)}PULP_MANIFEST`,
      ]);
    });

    it('keeps the credentials of a guarded distribution as the placeholders when the values are hostile', () => {
      const guarded = { ...input, guarded: true };

      expect(
        shellWords(
          snippet('curl')
            .build(guarded)
            .replace(/^curl /, ''),
        ),
      ).toEqual([
        '-fSLO',
        '-u',
        '<user>:<token>',
        `${withSlash(hostileUrl)}<path>`,
      ]);
    });
  });
});

function withSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}
