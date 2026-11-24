import { describe, expect, it } from 'vitest';
import type { SnippetDef, SnippetInput } from 'src/framework/descriptor';
import { UnsafeValueError } from 'src/framework/snippets/quote';
import { shellWords, snippetInput } from 'src/test-utils/snippets';
import { debSnippets } from './deb/snippets';
import { fileSnippets } from './file/snippets';
import { pythonSnippets } from './python/snippets';
import { rpmSnippets } from './rpm/snippets';

const find = (snippets: SnippetDef[], id: string): SnippetDef => {
  const found = snippets.find((snippet) => snippet.id === id);
  if (!found) {
    throw new Error(`no snippet ${id}`);
  }
  return found;
};

// What the snippets of a plugin show for the input, without those that do not
// apply to it.
const shown = (snippets: SnippetDef[], input: SnippetInput) =>
  snippets.filter(({ when }) => when === undefined || when(input));

const ids = (snippets: SnippetDef[], input: SnippetInput) =>
  shown(snippets, input).map(({ id }) => id);

const entry = (over: Partial<NonNullable<SnippetInput['entry']>> = {}) => ({
  read: 'https://packages.example.org/content/deb/cust-1/',
  write: null,
  signingKey: null,
  suite: null,
  components: null,
  ...over,
});

const DEB_URL = 'https://pulp.example.com/pulp/content/deb/cust-1/';
const deb = (over: Partial<SnippetInput> = {}) =>
  snippetInput({
    name: 'cust-1',
    basePath: 'deb/cust-1',
    url: DEB_URL,
    repositoryName: 'cust-1-repo',
    ...over,
  });

const RPM_URL = 'https://pulp.example.com/pulp/content/rpm/cust-1/';
const rpm = (over: Partial<SnippetInput> = {}) =>
  snippetInput({
    name: 'cust-1',
    basePath: 'rpm/cust-1',
    url: RPM_URL,
    repositoryName: 'cust-1-repo',
    ...over,
  });

const PY_URL = 'https://pulp.example.com/pypi/pypi-local/';
const python = (over: Partial<SnippetInput> = {}) =>
  snippetInput({
    name: 'pypi-local',
    basePath: 'pypi-local',
    url: PY_URL,
    repositoryName: 'pypi-local-repo',
    ...over,
  });

describe('Unit: deb client snippets', { tags: ['unit'] }, () => {
  it('offers the sources entry and the pulp command line of a public distribution, and nothing for credentials or a key', () => {
    expect(ids(debSnippets, deb())).toEqual(['sources', 'pulp-cli']);
  });

  it('writes a DEB822 sources entry with the suite and component left to fill in', () => {
    expect(find(debSnippets, 'sources').build(deb())).toBe(
      [
        '# /etc/apt/sources.list.d/cust-1.sources',
        'Types: deb',
        `URIs: ${DEB_URL}`,
        'Suites: <suite>',
        'Components: <component>',
      ].join('\n'),
    );
  });

  it('takes the suite and components from the entry point when it names them, and the address from its read address', () => {
    const input = deb({
      entry: entry({ suite: 'stable', components: ['main', 'contrib'] }),
    });

    expect(find(debSnippets, 'sources').build(input)).toBe(
      [
        '# /etc/apt/sources.list.d/cust-1.sources',
        'Types: deb',
        'URIs: https://packages.example.org/content/deb/cust-1/',
        'Suites: stable',
        'Components: main contrib',
      ].join('\n'),
    );
  });

  it('adds Signed-By and the command that fetches the key when the entry point names a signing key', () => {
    const input = deb({
      entry: entry({
        suite: 'stable',
        components: ['main'],
        signingKey: 'https://packages.example.org/signing.asc',
      }),
    });

    expect(ids(debSnippets, input)).toEqual([
      'sources',
      'signing-key',
      'pulp-cli',
    ]);
    expect(find(debSnippets, 'sources').build(input)).toContain(
      'Signed-By: /etc/apt/keyrings/cust-1.asc',
    );
    expect(find(debSnippets, 'signing-key').build(input)).toBe(
      "sudo curl -fsSL --create-dirs -o '/etc/apt/keyrings/cust-1.asc' 'https://packages.example.org/signing.asc'",
    );
  });

  it('adds an apt auth.conf entry with the placeholders for a guarded distribution, and never puts them in the sources entry', () => {
    const input = deb({ guarded: true });

    expect(ids(debSnippets, input)).toEqual(['sources', 'auth', 'pulp-cli']);
    expect(find(debSnippets, 'auth').build(input)).toBe(
      [
        '# /etc/apt/auth.conf.d/cust-1.conf',
        'machine pulp.example.com/pulp/content/deb/cust-1 login <user> password <token>',
      ].join('\n'),
    );
    expect(find(debSnippets, 'sources').build(input)).not.toMatch(/user|token/);
  });

  it('writes the pulp command line for the distribution with the suite to fill in', () => {
    expect(find(debSnippets, 'pulp-cli').build(deb())).toBe(
      `pulp deb remote create --name 'cust-1-repo' --url '${DEB_URL}' --distributions '<suite>'`,
    );
    expect(
      find(debSnippets, 'pulp-cli').build(
        deb({ entry: entry({ suite: 'stable' }) }),
      ),
    ).toBe(
      "pulp deb remote create --name 'cust-1-repo' --url 'https://packages.example.org/content/deb/cust-1/' --distributions 'stable'",
    );
  });

  describe('with hostile values', () => {
    it('refuses a name or address with a line break, which would add a field to the file', () => {
      expect(() =>
        find(debSnippets, 'sources').build(
          deb({
            entry: entry({ suite: 'stable\nSigned-By: /tmp/evil.asc' }),
          }),
        ),
      ).toThrow(UnsafeValueError);
      expect(() =>
        find(debSnippets, 'sources').build(
          deb({
            entry: entry({ components: ['main\nTypes: deb-src'] }),
          }),
        ),
      ).toThrow(UnsafeValueError);
    });

    it('encodes whitespace of an address, so it stays one address', () => {
      expect(
        find(debSnippets, 'sources').build(
          deb({ url: 'https://pulp.example.com/a b/ c/' }),
        ),
      ).toContain('URIs: https://pulp.example.com/a%20b/%20c/\n');
    });

    it('keeps a hostile name out of the file name of the comment and of the key path', () => {
      const input = deb({
        name: '../../etc/cron.d/x; rm -rf ~',
        entry: entry({
          signingKey: 'https://packages.example.org/signing.asc',
        }),
      });

      expect(find(debSnippets, 'sources').build(input)).toContain(
        '# /etc/apt/sources.list.d/etc-cron.d-x-rm-rf.sources',
      );
      expect(find(debSnippets, 'signing-key').build(input)).toContain(
        "'/etc/apt/keyrings/etc-cron.d-x-rm-rf.asc'",
      );
    });

    it('hands the shell the hostile repository name and address as data', () => {
      const hostile = "x'; rm -rf ~ #$(id)";
      const words = shellWords(
        find(debSnippets, 'pulp-cli')
          .build(
            deb({
              repositoryName: hostile,
              url: `https://pulp.example.com/${hostile}/`,
            }),
          )
          .replace(/^pulp deb remote create /, ''),
      );

      expect(words).toEqual([
        '--name',
        hostile,
        '--url',
        `https://pulp.example.com/${hostile}/`,
        '--distributions',
        '<suite>',
      ]);
    });
  });
});

describe('Unit: rpm client snippets', { tags: ['unit'] }, () => {
  it('offers the repo file and the pulp command line', () => {
    expect(ids(rpmSnippets, rpm())).toEqual(['repo-file', 'pulp-cli']);
  });

  it('writes a .repo file for a public distribution without checks it cannot make', () => {
    expect(find(rpmSnippets, 'repo-file').build(rpm())).toBe(
      [
        '# /etc/yum.repos.d/cust-1.repo',
        '[cust-1]',
        'name=cust-1',
        `baseurl=${RPM_URL}`,
        'enabled=1',
      ].join('\n'),
    );
  });

  it('checks signatures against the key the entry point names', () => {
    const input = rpm({
      entry: entry({
        read: 'https://packages.example.org/content/rpm/cust-1/',
        signingKey: 'https://packages.example.org/signing.asc',
      }),
    });

    expect(find(rpmSnippets, 'repo-file').build(input)).toBe(
      [
        '# /etc/yum.repos.d/cust-1.repo',
        '[cust-1]',
        'name=cust-1',
        'baseurl=https://packages.example.org/content/rpm/cust-1/',
        'enabled=1',
        'gpgcheck=1',
        'repo_gpgcheck=1',
        'gpgkey=https://packages.example.org/signing.asc',
      ].join('\n'),
    );
  });

  it('adds the placeholders as username and password for a guarded distribution', () => {
    expect(find(rpmSnippets, 'repo-file').build(rpm({ guarded: true }))).toBe(
      [
        '# /etc/yum.repos.d/cust-1.repo',
        '[cust-1]',
        'name=cust-1',
        `baseurl=${RPM_URL}`,
        'enabled=1',
        'username=<user>',
        'password=<token>',
      ].join('\n'),
    );
  });

  it('writes the pulp command line', () => {
    expect(find(rpmSnippets, 'pulp-cli').build(rpm())).toBe(
      `pulp rpm remote create --name 'cust-1-repo' --url '${RPM_URL}'`,
    );
  });

  describe('with hostile values', () => {
    it('turns a name into a section header that cannot close or reopen the file', () => {
      const text = find(rpmSnippets, 'repo-file').build(
        rpm({ name: 'x]', basePath: 'rpm/x' }),
      );

      expect(text.split('\n')[1]).toBe('[x]');
    });

    it('refuses a name that would add a line to the file', () => {
      expect(() =>
        find(rpmSnippets, 'repo-file').build(
          rpm({ name: 'nice\ngpgcheck=0\n[evil]' }),
        ),
      ).toThrow(UnsafeValueError);
    });

    it('encodes the dollar sign of an address, which dnf would read as a variable', () => {
      expect(
        find(rpmSnippets, 'repo-file').build(
          rpm({ url: 'https://pulp.example.com/$releasever/' }),
        ),
      ).toContain('baseurl=https://pulp.example.com/%24releasever/\n');
    });

    it('keeps the hostile file name of the comment inside the directory', () => {
      expect(
        find(rpmSnippets, 'repo-file')
          .build(rpm({ name: '../../x' }))
          .split('\n')[0],
      ).toBe('# /etc/yum.repos.d/x.repo');
    });
  });
});

describe('Unit: python client snippets', { tags: ['unit'] }, () => {
  it('offers pip, pip.conf and twine', () => {
    expect(ids(pythonSnippets, python())).toEqual(['pip', 'pip-conf', 'twine']);
  });

  it('installs from the simple index of the distribution, the package left to fill in', () => {
    expect(find(pythonSnippets, 'pip').build(python())).toBe(
      `pip install --index-url '${PY_URL}simple/' <package>`,
    );
  });

  it('adds the slash the server leaves off a distribution address', () => {
    expect(
      find(pythonSnippets, 'pip').build(
        python({ url: 'https://pulp.example.com/pypi/x' }),
      ),
    ).toBe(
      "pip install --index-url 'https://pulp.example.com/pypi/x/simple/' <package>",
    );
  });

  it('writes pip.conf with the index address', () => {
    expect(find(pythonSnippets, 'pip-conf').build(python())).toBe(
      [
        '# ~/.config/pip/pip.conf',
        '[global]',
        `index-url = ${PY_URL}simple/`,
      ].join('\n'),
    );
  });

  it('uploads to the legacy endpoint of the distribution with twine, with the account placeholders', () => {
    expect(find(pythonSnippets, 'twine').build(python())).toBe(
      `twine upload --repository-url '${PY_URL}legacy/' --username '<user>' --password '<token>' dist/*`,
    );
  });

  it('puts the placeholders before the host of the index of a guarded distribution', () => {
    const input = python({ guarded: true });

    expect(find(pythonSnippets, 'pip').build(input)).toBe(
      "pip install --index-url 'https://<user>:<token>@pulp.example.com/pypi/pypi-local/simple/' <package>",
    );
    expect(find(pythonSnippets, 'pip-conf').build(input)).toContain(
      'index-url = https://<user>:<token>@pulp.example.com/pypi/pypi-local/simple/',
    );
  });

  describe('with an entry point', () => {
    const point = entry({
      read: 'https://packages.example.org/repo/pypi/',
      write: 'https://packages.example.org/repo/pypi/legacy/',
    });

    it('reads from the entry read address and writes to its write address', () => {
      const input = python({ entry: point });

      expect(find(pythonSnippets, 'pip').build(input)).toBe(
        "pip install --index-url 'https://packages.example.org/repo/pypi/simple/' <package>",
      );
      expect(find(pythonSnippets, 'twine').build(input)).toContain(
        "--repository-url 'https://packages.example.org/repo/pypi/legacy/'",
      );
    });

    it('does not add the simple index twice to a read address that ends with it', () => {
      expect(
        find(pythonSnippets, 'pip').build(
          python({
            entry: entry({
              read: 'https://packages.example.org/repo/pypi/simple/',
            }),
          }),
        ),
      ).toBe(
        "pip install --index-url 'https://packages.example.org/repo/pypi/simple/' <package>",
      );
    });

    it('uploads to the legacy endpoint under the read address when the entry names no write address', () => {
      expect(
        find(pythonSnippets, 'twine').build(
          python({
            entry: entry({ read: 'https://packages.example.org/repo/pypi/' }),
          }),
        ),
      ).toContain(
        "--repository-url 'https://packages.example.org/repo/pypi/legacy/'",
      );
    });
  });

  describe('with hostile values', () => {
    const hostile = "https://pulp.example.com/a'; rm -rf ~ #/$(id)/";

    it('hands the shell the address as one word of data', () => {
      expect(
        shellWords(
          find(pythonSnippets, 'pip')
            .build(python({ url: hostile }))
            .replace(/^pip install /, '')
            .replace('<package>', 'pkg'),
        ),
      ).toEqual(['--index-url', `${hostile}simple/`, 'pkg']);
    });

    it('hands the shell one word for the upload address and keeps the glob unquoted', () => {
      expect(
        shellWords(
          find(pythonSnippets, 'twine')
            .build(python({ url: hostile }))
            .replace(/^twine upload /, ''),
        ),
      ).toEqual([
        '--repository-url',
        `${hostile}legacy/`,
        '--username',
        '<user>',
        '--password',
        '<token>',
        'dist/*',
      ]);
    });

    it('encodes whitespace and the dollar sign in pip.conf', () => {
      expect(
        find(pythonSnippets, 'pip-conf').build(
          python({ url: 'https://pulp.example.com/a b/$x/' }),
        ),
      ).toContain('index-url = https://pulp.example.com/a%20b/%24x/simple/');
    });
  });
});

describe('Unit: credentials in snippets', { tags: ['unit'] }, () => {
  const PLUGINS: [string, SnippetDef[], () => SnippetInput][] = [
    ['file', fileSnippets, () => snippetInput({ guarded: true })],
    [
      'deb',
      debSnippets,
      () =>
        deb({
          guarded: true,
          entry: entry({
            suite: 'stable',
            components: ['main'],
            signingKey: 'https://packages.example.org/signing.asc',
          }),
        }),
    ],
    [
      'rpm',
      rpmSnippets,
      () =>
        rpm({
          guarded: true,
          entry: entry({
            read: 'https://packages.example.org/content/rpm/cust-1/',
            signingKey: 'https://packages.example.org/signing.asc',
          }),
        }),
    ],
    ['python', pythonSnippets, () => python({ guarded: true })],
  ];

  // The text that follows each way a snippet names a credential.
  const CREDENTIAL_POSITIONS: RegExp[] = [
    /(?:^|\s)-u\s+'([^']*)'/g,
    /--user\s+'([^']*)'/g,
    /--username\s+'([^']*)'/g,
    /--password\s+'([^']*)'/g,
    /(?:^|\s)login\s+(\S+)/g,
    /(?:^|\s)password\s+(\S+)/g,
    /^username=(.*)$/gm,
    /^password=(.*)$/gm,
    /https?:\/\/([^/@\s']*)@/g,
  ];

  it.each(PLUGINS)(
    'holds only the placeholders in the credential positions of every guarded %s snippet',
    (_plugin, snippets, input) => {
      const found: string[] = [];

      for (const snippet of shown(snippets, input())) {
        const text = snippet.build(input());
        for (const position of CREDENTIAL_POSITIONS) {
          for (const match of Array.from(text.matchAll(position))) {
            found.push(match[1] as string);
          }
        }
      }

      // The positions are really found, so the check is not vacuous.
      expect(found.length).toBeGreaterThan(0);
      for (const value of found) {
        expect(['<user>', '<token>', '<user>:<token>']).toContain(value);
      }
    },
  );

  it.each(PLUGINS)(
    'replaces credentials an address already carries in every guarded %s snippet that writes credentials into addresses',
    (_plugin, snippets, input) => {
      const leaky = {
        ...input(),
        url: 'https://leaked:secret@pulp.example.com/pulp/content/x/',
      };

      for (const snippet of shown(snippets, leaky)) {
        const text = snippet.build(leaky);
        for (const match of Array.from(
          text.matchAll(/https?:\/\/([^/@\s']*)@/g),
        )) {
          expect(match[1]).toBe('<user>:<token>');
        }
      }
    },
  );

  it.each(PLUGINS)(
    'asks for no download credentials in a public %s snippet',
    (_plugin, snippets, input) => {
      const publicInput = { ...input(), guarded: false };

      for (const snippet of shown(snippets, publicInput)) {
        const text = snippet.build(publicInput);
        expect(text).not.toMatch(/login|--user\b|--ask-password|@/);
        expect(text).not.toMatch(/^(username|password)=/m);
        expect(text).not.toMatch(/(?:^|\s)-u\s/);
      }
    },
  );
});
