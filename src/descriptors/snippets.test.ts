import { describe, expect, it } from 'vitest';
import type { SnippetDef, SnippetInput } from 'src/framework/descriptor';
import { UnsafeValueError } from 'src/framework/snippets/quote';
import { shellWords, snippetInput } from 'src/test-utils/snippets';
import { ansibleSnippets } from './ansible/snippets';
import { containerSnippets } from './container/snippets';
import { debSnippets } from './deb/snippets';
import { fileSnippets } from './file/snippets';
import { mavenSnippets } from './maven/snippets';
import { npmSnippets } from './npm/snippets';
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

// What the XML of a snippet says, read the way Maven reads it.
function xmlDocument(text: string): Document {
  const parsed = new DOMParser().parseFromString(text, 'application/xml');

  expect(parsed.querySelector('parsererror')?.textContent ?? '').toBe('');
  return parsed;
}

// The value of a Kotlin string literal, read back.
function kotlinValue(literal: string): string {
  return literal
    .slice(1, -1)
    .replace(/\\(?:u([0-9a-f]{4})|(.))/gi, (_, hex, ch) =>
      hex ? String.fromCharCode(Number.parseInt(hex, 16)) : (ch as string),
    );
}

const MAVEN_URL = 'https://pulp.example.com/pulp/content/maven-releases/';
const DEPLOY_URL = 'https://pulp.example.com/pulp/maven/maven-releases/';
const maven = (over: Partial<SnippetInput> = {}) =>
  snippetInput({
    name: 'maven-releases',
    basePath: 'maven-releases',
    url: MAVEN_URL,
    repositoryName: 'maven-releases',
    ...over,
  });

describe('Unit: maven client snippets', { tags: ['unit'] }, () => {
  it('offers settings.xml, Gradle and the two ways to deploy', () => {
    expect(ids(mavenSnippets, maven())).toEqual([
      'settings',
      'gradle',
      'pom',
      'gradle-publish',
    ]);
  });

  it('offers no way to deploy when the distribution serves no repository, and none to a repository it does not know', () => {
    expect(ids(mavenSnippets, maven({ repositoryName: null }))).toEqual([
      'settings',
      'gradle',
    ]);
  });

  it('offers the deploy snippets without a repository name when the entry point names a write address', () => {
    expect(
      ids(
        mavenSnippets,
        maven({
          repositoryName: null,
          entry: entry({ write: 'https://packages.example.org/pulp/maven/x/' }),
        }),
      ),
    ).toEqual(['settings', 'gradle', 'pom', 'gradle-publish']);
  });

  describe('settings.xml', () => {
    const settings = (over: Partial<SnippetInput> = {}) =>
      xmlDocument(find(mavenSnippets, 'settings').build(maven(over)));
    const text = (over: Partial<SnippetInput> = {}) =>
      find(mavenSnippets, 'settings').build(maven(over));

    it('mirrors everything to the distribution and enables releases and snapshots in a profile', () => {
      const doc = settings();

      expect(doc.querySelector('mirror > mirrorOf')?.textContent).toBe('*');
      expect(doc.querySelector('mirror > url')?.textContent).toBe(MAVEN_URL);
      expect(doc.querySelector('activeProfile')?.textContent).toBe('pulp');
      for (const selector of [
        'profile > repositories > repository',
        'profile > pluginRepositories > pluginRepository',
      ]) {
        const element = doc.querySelector(selector);

        expect(element?.querySelector('url')?.textContent).toBe(MAVEN_URL);
        expect(element?.querySelector('releases > enabled')?.textContent).toBe(
          'true',
        );
        expect(element?.querySelector('snapshots > enabled')?.textContent).toBe(
          'true',
        );
      }
    });

    it('reads from the entry point address when the deployment names one', () => {
      const doc = settings({
        entry: entry({ read: 'https://packages.example.org/repo/maven/' }),
      });

      expect(doc.querySelector('mirror > url')?.textContent).toBe(
        'https://packages.example.org/repo/maven/',
      );
    });

    it('holds a server for deploying only, with the placeholders, when the distribution is public', () => {
      const doc = settings();
      const servers = Array.from(doc.querySelectorAll('server')).map(
        (server) => [
          server.querySelector('id')?.textContent,
          server.querySelector('username')?.textContent,
          server.querySelector('password')?.textContent,
        ],
      );

      expect(servers).toEqual([['pulp-deploy', '<user>', '<token>']]);
    });

    it('adds a server for the mirror with the placeholders when the distribution is guarded', () => {
      const doc = settings({ guarded: true });
      const servers = Array.from(doc.querySelectorAll('server')).map(
        (server) => [
          server.querySelector('id')?.textContent,
          server.querySelector('username')?.textContent,
          server.querySelector('password')?.textContent,
        ],
      );

      expect(servers).toEqual([
        ['pulp', '<user>', '<token>'],
        ['pulp-deploy', '<user>', '<token>'],
      ]);
      expect(text({ guarded: true })).toContain('&lt;user&gt;');
    });

    it('holds no server when nothing can be deployed and the distribution is public', () => {
      expect(
        settings({ repositoryName: null }).querySelector('servers'),
      ).toBeNull();
    });

    it('writes an address with markup in it as the same address', () => {
      const hostile = 'https://pulp.example.com/a&b<c>"d\'e/';
      const doc = settings({ url: hostile });

      expect(doc.querySelector('mirror > url')?.textContent).toBe(hostile);
      expect(doc.querySelectorAll('url')).toHaveLength(3);
      for (const url of Array.from(doc.querySelectorAll('url'))) {
        expect(url.textContent).toBe(hostile);
      }
    });

    it('refuses an address XML cannot hold', () => {
      expect(() => text({ url: 'https://pulp.example.com/a\u0001b/' })).toThrow(
        UnsafeValueError,
      );
    });
  });

  describe('Gradle', () => {
    const build = (over: Partial<SnippetInput> = {}) =>
      find(mavenSnippets, 'gradle').build(maven(over));

    it('declares the distribution for plugins and for dependencies in settings.gradle.kts', () => {
      expect(build()).toBe(
        [
          '// settings.gradle.kts',
          'pluginManagement {',
          '    repositories {',
          '        maven {',
          `            url = uri("${MAVEN_URL}")`,
          '        }',
          '    }',
          '}',
          'dependencyResolutionManagement {',
          '    repositories {',
          '        maven {',
          `            url = uri("${MAVEN_URL}")`,
          '        }',
          '    }',
          '}',
        ].join('\n'),
      );
    });

    it('adds credentials with the placeholders, sent without waiting for a challenge, for a guarded distribution', () => {
      const text = build({ guarded: true });

      expect(text.match(/username = "<user>"/g)).toHaveLength(2);
      expect(text.match(/password = "<token>"/g)).toHaveLength(2);
      expect(
        text.match(/create<BasicAuthentication>\("basic"\)/g),
      ).toHaveLength(2);
    });

    it('writes an address with quotes, backslashes and dollar signs as the same string', () => {
      const hostile = 'https://pulp.example.com/a"b\\c$d${e}/';
      const literals = Array.from(
        build({ url: hostile }).matchAll(/uri\(("(?:[^"\\]|\\.)*")\)/g),
      ).map((match) => kotlinValue(match[1] as string));

      expect(literals).toEqual([hostile, hostile]);
    });
  });

  describe('deploying', () => {
    it('writes the distributionManagement of the pom with the deploy address of the repository', () => {
      const doc = xmlDocument(find(mavenSnippets, 'pom').build(maven()));

      expect(
        doc.querySelector('distributionManagement > repository > id')
          ?.textContent,
      ).toBe('pulp-deploy');
      expect(
        doc.querySelector('distributionManagement > repository > url')
          ?.textContent,
      ).toBe(DEPLOY_URL);
    });

    it('deploys to the address the entry point names when it names one', () => {
      const doc = xmlDocument(
        find(mavenSnippets, 'pom').build(
          maven({
            entry: entry({
              write: 'https://packages.example.org/pulp/maven/maven-releases/',
            }),
          }),
        ),
      );

      expect(
        doc.querySelector('distributionManagement > repository > url')
          ?.textContent,
      ).toBe('https://packages.example.org/pulp/maven/maven-releases/');
    });

    it('writes the publishing block of Gradle with the placeholders', () => {
      const text = find(mavenSnippets, 'gradle-publish').build(maven());

      expect(text).toBe(
        [
          '// build.gradle.kts',
          'publishing {',
          '    repositories {',
          '        maven {',
          '            name = "pulp"',
          `            url = uri("${DEPLOY_URL}")`,
          '            credentials {',
          '                username = "<user>"',
          '                password = "<token>"',
          '            }',
          '            authentication {',
          '                create<BasicAuthentication>("basic")',
          '            }',
          '        }',
          '    }',
          '}',
        ].join('\n'),
      );
    });

    it('encodes a repository name in the deploy address, and writes it safely into XML and Kotlin', () => {
      const hostile = 'a"b&<c>$d e';
      const encoded = `https://pulp.example.com/pulp/maven/${encodeURIComponent(hostile)}/`;
      const pom = xmlDocument(
        find(mavenSnippets, 'pom').build(maven({ repositoryName: hostile })),
      );
      const gradle = find(mavenSnippets, 'gradle-publish').build(
        maven({ repositoryName: hostile }),
      );

      expect(
        pom.querySelector('distributionManagement > repository > url')
          ?.textContent,
      ).toBe(encoded);
      expect(
        kotlinValue(
          (
            gradle.match(/uri\(("(?:[^"\\]|\\.)*")\)/) as RegExpMatchArray
          )[1] as string,
        ),
      ).toBe(encoded);
    });
  });
});

const NPM_URL = 'https://pulp.example.com/pulp/content/npm-local/';
const NPM_PUBLISH = 'https://pulp.example.com/npm/npm-local/';
const npm = (over: Partial<SnippetInput> = {}) =>
  snippetInput({
    name: 'npm-local',
    basePath: 'npm-local',
    url: NPM_URL,
    repositoryName: 'npm-local',
    ...over,
  });

describe('Unit: npm client snippets', { tags: ['unit'] }, () => {
  it('offers .npmrc and npm publish', () => {
    expect(ids(npmSnippets, npm())).toEqual(['npmrc', 'publish']);
  });

  it('points the registry at the distribution and holds the placeholder auth line of the publish address', () => {
    expect(find(npmSnippets, 'npmrc').build(npm())).toBe(
      [
        '# ~/.npmrc',
        `registry=${NPM_URL}`,
        '# Needed to publish: <base64> is the base64 encoding of <user>:<token>',
        '//pulp.example.com/npm/npm-local/:_auth=<base64>',
      ].join('\n'),
    );
  });

  it('adds the auth line of the registry itself when the distribution is guarded', () => {
    expect(find(npmSnippets, 'npmrc').build(npm({ guarded: true }))).toBe(
      [
        '# ~/.npmrc',
        `registry=${NPM_URL}`,
        '# <base64> is the base64 encoding of <user>:<token>',
        '//pulp.example.com/pulp/content/npm-local/:_auth=<base64>',
        '//pulp.example.com/npm/npm-local/:_auth=<base64>',
      ].join('\n'),
    );
  });

  it('publishes to the publish address of the distribution', () => {
    expect(find(npmSnippets, 'publish').build(npm())).toBe(
      `npm publish --registry '${NPM_PUBLISH}'`,
    );
  });

  describe('with an entry point', () => {
    const point = entry({
      read: 'https://packages.example.org/repo/npm/',
      write: 'https://packages.example.org/repo/npm/',
    });

    it('reads and publishes at the entry point, with one auth line for the one address', () => {
      const input = npm({ entry: point, guarded: true });

      expect(find(npmSnippets, 'npmrc').build(input)).toBe(
        [
          '# ~/.npmrc',
          'registry=https://packages.example.org/repo/npm/',
          '# <base64> is the base64 encoding of <user>:<token>',
          '//packages.example.org/repo/npm/:_auth=<base64>',
        ].join('\n'),
      );
      expect(find(npmSnippets, 'publish').build(input)).toBe(
        "npm publish --registry 'https://packages.example.org/repo/npm/'",
      );
    });

    it('publishes to the read address when the entry names no write address', () => {
      expect(
        find(npmSnippets, 'publish').build(
          npm({
            entry: entry({ read: 'https://packages.example.org/repo/npm/' }),
          }),
        ),
      ).toBe(
        "npm publish --registry 'https://packages.example.org/npm/npm-local/'",
      );
    });
  });

  describe('with hostile values', () => {
    it('encodes what an npmrc reader takes for a comment, an escape or a variable', () => {
      const text = find(npmSnippets, 'npmrc').build(
        npm({ url: 'https://pulp.example.com/a;b#c\\d$e f/' }),
      );

      expect(text).toContain(
        'registry=https://pulp.example.com/a%3Bb%23c%5Cd%24e%20f/\n',
      );
    });

    it('refuses an address with a line break, which would add a line to the file', () => {
      expect(() =>
        find(npmSnippets, 'npmrc').build(
          npm({
            url: 'https://pulp.example.com/a\nregistry=https://other.example.org/',
          }),
        ),
      ).toThrow(UnsafeValueError);
    });

    it('hands the shell the publish address as one word of data', () => {
      const hostile = "x'; rm -rf ~ #$(id)";

      expect(
        shellWords(
          find(npmSnippets, 'publish')
            .build(npm({ basePath: hostile }))
            .replace(/^npm publish /, ''),
        ),
      ).toEqual([
        '--registry',
        `https://pulp.example.com/npm/${encodeURIComponent(hostile)}/`,
      ]);
    });
  });
});

const ANSIBLE_URL =
  'https://pulp.example.com/pulp_ansible/galaxy/ansible-local/';
const ansible = (over: Partial<SnippetInput> = {}) =>
  snippetInput({
    name: 'ansible-local',
    basePath: 'ansible-local',
    url: ANSIBLE_URL,
    repositoryName: 'ansible-local',
    ...over,
  });

describe('Unit: ansible client snippets', { tags: ['unit'] }, () => {
  it('offers ansible.cfg, install and publish', () => {
    expect(ids(ansibleSnippets, ansible())).toEqual([
      'ansible-cfg',
      'install',
      'publish',
    ]);
  });

  it('writes a galaxy server with the client address and the placeholders, whether or not the distribution is guarded', () => {
    const expected = [
      '# ansible.cfg',
      '[galaxy]',
      'server_list = ansible-local',
      '',
      '[galaxy_server.ansible-local]',
      `url = ${ANSIBLE_URL}`,
      'username = <user>',
      'password = <token>',
    ].join('\n');

    expect(find(ansibleSnippets, 'ansible-cfg').build(ansible())).toBe(
      expected,
    );
    expect(
      find(ansibleSnippets, 'ansible-cfg').build(ansible({ guarded: true })),
    ).toBe(expected);
  });

  it('installs a collection and publishes an archive through the configured server', () => {
    expect(find(ansibleSnippets, 'install').build(ansible())).toBe(
      "ansible-galaxy collection install --server 'ansible-local' <namespace.name>",
    );
    expect(find(ansibleSnippets, 'publish').build(ansible())).toBe(
      "ansible-galaxy collection publish <archive> --server 'ansible-local'",
    );
  });

  it('adds the slash the server leaves off the client address', () => {
    expect(
      find(ansibleSnippets, 'ansible-cfg').build(
        ansible({ url: 'https://pulp.example.com/pulp_ansible/galaxy/x' }),
      ),
    ).toContain('url = https://pulp.example.com/pulp_ansible/galaxy/x/\n');
  });

  it('takes the address from the entry point when it names one', () => {
    expect(
      find(ansibleSnippets, 'ansible-cfg').build(
        ansible({
          entry: entry({ read: 'https://packages.example.org/galaxy/' }),
        }),
      ),
    ).toContain('url = https://packages.example.org/galaxy/\n');
  });

  describe('with hostile values', () => {
    it('reduces a name to a section name that cannot close the section or start another', () => {
      const text = find(ansibleSnippets, 'ansible-cfg').build(
        ansible({ name: 'x]\n[evil]\nurl=https://other.example.org/' }),
      );

      expect(text.split('\n')).toContain(
        'server_list = x-evil-url-https-other.example.org',
      );
      expect(text.match(/^\[/gm)).toHaveLength(2);
    });

    it('refuses an address with a line break', () => {
      expect(() =>
        find(ansibleSnippets, 'ansible-cfg').build(
          ansible({ url: 'https://pulp.example.com/a\nusername = root' }),
        ),
      ).toThrow(UnsafeValueError);
    });

    it('encodes whitespace and the dollar sign of an address', () => {
      expect(
        find(ansibleSnippets, 'ansible-cfg').build(
          ansible({ url: 'https://pulp.example.com/a b/$x/' }),
        ),
      ).toContain('url = https://pulp.example.com/a%20b/%24x/\n');
    });

    it('hands the shell the server name as one word of data', () => {
      expect(
        shellWords(
          find(ansibleSnippets, 'install')
            .build(ansible({ name: "x'; rm -rf ~ #$(id)" }))
            .replace(/^ansible-galaxy collection install /, '')
            .replace('<namespace.name>', 'a.b'),
        ),
      ).toEqual(['--server', 'x-rm-rf-id', 'a.b']);
    });
  });
});

const CONTAINER_URL = 'https://pulp.example.com/pulp/content/team/app/';
const container = (over: Partial<SnippetInput> = {}) =>
  snippetInput({
    name: 'team-app',
    basePath: 'team/app',
    url: CONTAINER_URL,
    guarded: true,
    repositoryName: 'team-app',
    ...over,
  });

describe('Unit: container client snippets', { tags: ['unit'] }, () => {
  it('offers login, pull and push', () => {
    expect(ids(containerSnippets, container())).toEqual([
      'login',
      'pull',
      'push',
    ]);
  });

  it('logs in to, pulls from and pushes to the registry of the page with the base path of the distribution', () => {
    expect(find(containerSnippets, 'login').build(container())).toBe(
      "podman login --username '<user>' 'pulp.example.com'",
    );
    expect(find(containerSnippets, 'pull').build(container())).toBe(
      "podman pull 'pulp.example.com/team/app:<tag>'",
    );
    expect(find(containerSnippets, 'push').build(container())).toBe(
      "podman push 'pulp.example.com/team/app:<tag>'",
    );
  });

  it('keeps the port of the page origin', () => {
    expect(
      find(containerSnippets, 'pull').build(
        container({ origin: 'https://pulp.example.com:8443' }),
      ),
    ).toBe("podman pull 'pulp.example.com:8443/team/app:<tag>'");
  });

  it('takes the registry host from the entry point when the deployment names one', () => {
    const input = container({
      entry: entry({ read: 'https://registry.example.org/' }),
    });

    expect(find(containerSnippets, 'login').build(input)).toBe(
      "podman login --username '<user>' 'registry.example.org'",
    );
    expect(find(containerSnippets, 'push').build(input)).toBe(
      "podman push 'registry.example.org/team/app:<tag>'",
    );
  });

  it('hands the shell a hostile base path as one word of data', () => {
    expect(
      shellWords(
        find(containerSnippets, 'pull')
          .build(container({ basePath: "x'; rm -rf ~ #$(id)" }))
          .replace(/^podman pull /, ''),
      ),
    ).toEqual(["pulp.example.com/x'; rm -rf ~ #$(id):<tag>"]);
  });

  it('refuses an origin that is not an address', () => {
    expect(() =>
      find(containerSnippets, 'pull').build(
        container({ origin: 'not an address' }),
      ),
    ).toThrow(UnsafeValueError);
  });
});

describe(
  'Unit: credentials in maven, npm, ansible and container snippets',
  { tags: ['unit'] },
  () => {
    const PLUGINS: [string, SnippetDef[], SnippetInput][] = [
      ['maven', mavenSnippets, maven({ guarded: true })],
      ['npm', npmSnippets, npm({ guarded: true })],
      ['ansible', ansibleSnippets, ansible({ guarded: true })],
      ['container', containerSnippets, container()],
    ];
    const SECRET = /secret|leaked/;

    it.each(PLUGINS)(
      'holds only the placeholders where a guarded %s snippet names a credential',
      (_plugin, snippets, input) => {
        const found: string[] = [];

        for (const snippet of shown(snippets, input)) {
          const text = snippet.build(input);
          for (const position of [
            /--username\s+'([^']*)'/g,
            /^\s*username = (.*)$/gm,
            /^\s*password = (.*)$/gm,
            /<(?:username|password)>(.*)<\/(?:username|password)>/g,
            /_auth=(.*)$/gm,
            /https?:\/\/([^/@\s']*)@/g,
          ]) {
            for (const match of Array.from(text.matchAll(position))) {
              found.push(match[1] as string);
            }
          }
        }

        expect(found.length).toBeGreaterThan(0);
        for (const value of found) {
          expect([
            '<user>',
            '<token>',
            '&lt;user&gt;',
            '&lt;token&gt;',
            '"<user>"',
            '"<token>"',
            '<base64>',
          ]).toContain(value);
        }
      },
    );

    it.each(PLUGINS)(
      'drops credentials an address already carries from every %s snippet',
      (_plugin, snippets, input) => {
        const leaky = {
          ...input,
          url: 'https://leaked:secret@pulp.example.com/pulp/content/x/',
          entry: entry({
            read: 'https://leaked:secret@packages.example.org/x/',
          }),
        };

        for (const snippet of shown(snippets, leaky)) {
          expect(snippet.build(leaky)).not.toMatch(SECRET);
        }
      },
    );
  },
);
