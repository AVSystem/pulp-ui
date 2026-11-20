// @vitest-environment node
// Four import rules apply to the same files and must not replace one another:
// the PatternFly components that have an app wrapper, the deprecated
// PatternFly entry point, the barrels of src/api, src/utilities and
// src/actions, and the generated sdk, which only src/entities may import. A
// flat-config block that sets the options of a rule replaces the options of
// every earlier block, so each rule is proven here through the effective
// configuration of a source file and through reported messages. A fifth check
// keeps the generated validation modules out of the running application: they
// are imported for their types only.
import { ESLint, type Linter } from 'eslint';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const WRAPPER_MESSAGE = 'Import from src/components instead.';
const TABLE_MESSAGE = 'Import Table from src/components instead.';
const SDK_MESSAGE = 'Import the sdk only from src/entities.';
const ZOD_MESSAGE = 'Generated .zod modules are imported for types only';

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: ROOT });
});

// Messages of the two import rules for the given source, linted as if it
// lived at the given path under the repository root.
async function reports(source: string, path = 'src/containers/page.tsx') {
  const [result] = await eslint.lintText(source, {
    filePath: resolve(ROOT, path),
  });
  return result.messages.filter(
    (message) =>
      message.ruleId === 'no-restricted-imports' ||
      message.ruleId === '@typescript-eslint/no-restricted-imports' ||
      (message.ruleId === 'no-restricted-syntax' &&
        message.message.includes(ZOD_MESSAGE)),
  );
}

describe('the PatternFly import rule', () => {
  it.each(['Alert', 'Chip', 'Spinner', 'Tooltip'])(
    'reports %s imported from react-core',
    async (name) => {
      const found = await reports(
        `import { ${name} } from '@patternfly/react-core';\nexport const x = ${name};`,
      );

      expect(found).toHaveLength(1);
      expect(found[0].ruleId).toBe('no-restricted-imports');
      expect(found[0].severity).toBe(2);
      expect(found[0].message).toContain(WRAPPER_MESSAGE);
    },
  );

  it('accepts a component that has no wrapper', async () => {
    expect(
      await reports(
        "import { Button } from '@patternfly/react-core';\nexport const x = Button;",
      ),
    ).toEqual([]);
  });

  it('lets a wrapper import the part it wraps', async () => {
    expect(
      await reports(
        "import { Alert } from '@patternfly/react-core';\nexport const x = Alert;",
        'src/components/patternfly-wrappers/alert.tsx',
      ),
    ).toEqual([]);
  });
});

describe('the table import rule', () => {
  it('reports Table imported from react-table', async () => {
    const found = await reports(
      "import { Table } from '@patternfly/react-table';\nexport const x = Table;",
    );

    expect(found).toHaveLength(1);
    expect(found[0].ruleId).toBe('no-restricted-imports');
    expect(found[0].severity).toBe(2);
    expect(found[0].message).toContain(TABLE_MESSAGE);
  });

  it('reports Table among other table parts', async () => {
    const found = await reports(
      "import { Table, Tbody, Td } from '@patternfly/react-table';\nexport const x = [Table, Tbody, Td];",
    );

    expect(found).toHaveLength(1);
    expect(found[0].message).toContain(TABLE_MESSAGE);
  });

  it.each(['Thead', 'Tbody', 'Tr', 'Th', 'Td'])(
    'accepts %s imported from react-table',
    async (name) => {
      expect(
        await reports(
          `import { ${name} } from '@patternfly/react-table';\nexport const x = ${name};`,
        ),
      ).toEqual([]);
    },
  );

  it('lets the wrapper import the table it wraps', async () => {
    expect(
      await reports(
        "import { Table } from '@patternfly/react-table';\nexport const x = Table;",
        'src/components/table.tsx',
      ),
    ).toEqual([]);
  });
});

describe('the deprecated entry point rule', () => {
  it.each([
    "import { Select } from '@patternfly/react-core/deprecated';",
    "import * as deprecated from '@patternfly/react-core/deprecated';",
    "import { Select } from '@patternfly/react-core/deprecated/components/Select';",
    "import { Select } from '@patternfly/react-core/dist/esm/deprecated/components/Select';",
  ])('reports %s', async (source) => {
    const found = await reports(`${source}\nexport const x = 1;`);

    expect(found.length).toBeGreaterThan(0);
    expect(found[0].severity).toBe(2);
    expect(found[0].message).toMatch(/deprecated entry point is not used/);
  });
});

describe('the barrel import rule', () => {
  it.each(['src/api', 'src/utilities', 'src/actions'])(
    'warns about the %s barrel',
    async (barrel) => {
      const found = await reports(
        `import { x } from '${barrel}';\nexport const y = x;`,
      );

      expect(found).toHaveLength(1);
      expect(found[0].ruleId).toBe('@typescript-eslint/no-restricted-imports');
      expect(found[0].severity).toBe(1);
      expect(found[0].message).toMatch(/specific file and not the barrel/);
    },
  );

  it('accepts a specific file of the same directory', async () => {
    expect(
      await reports("import { x } from 'src/api/user';\nexport const y = x;"),
    ).toEqual([]);
  });
});

describe('the sdk import rule', () => {
  it.each([
    ['src/containers/page.tsx', '@pulp-ui/sdk/core/login'],
    ['src/components/x.tsx', '@pulp-ui/sdk/core/status'],
    ['src/components/x.tsx', '@pulp-ui/sdk/core/models/login/login-response'],
    ['src/containers/page.tsx', '@pulp-ui/sdk/mutator/pulp-fetch'],
    ['src/session/policy.ts', '@pulp-ui/sdk/file/repositories'],
  ])('reports %s importing %s', async (path, module) => {
    const found = await reports(
      `import { x } from '${module}';\nexport const y = x;`,
      path,
    );

    expect(found).toHaveLength(1);
    expect(found[0].ruleId).toBe('no-restricted-imports');
    expect(found[0].severity).toBe(2);
    expect(found[0].message).toContain(SDK_MESSAGE);
  });

  it('reports a type-only import outside src/entities too', async () => {
    const found = await reports(
      "import type { LoginResponse } from '@pulp-ui/sdk/core/models/login/login-response.zod';\nexport type X = LoginResponse;",
      'src/containers/page.tsx',
    );

    expect(found).toHaveLength(1);
    expect(found[0].message).toContain(SDK_MESSAGE);
  });

  it.each([
    'src/entities/core/status/client.ts',
    'src/entities/core/status/client.test.ts',
    'src/entities/sdk-setup.ts',
  ])('lets %s import the sdk', async (path) => {
    expect(
      await reports(
        "import { statusRead } from '@pulp-ui/sdk/core/status';\nexport const y = statusRead;",
        path,
      ),
    ).toEqual([]);
  });

  it('keeps the PatternFly rules for a file under src/entities', async () => {
    const found = await reports(
      "import { Alert } from '@patternfly/react-core';\nexport const x = Alert;",
      'src/entities/core/status/view.tsx',
    );

    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe(2);
    expect(found[0].message).toContain(WRAPPER_MESSAGE);
  });

  it('keeps the deprecated entry point rule for a file under src/entities', async () => {
    const found = await reports(
      "import { Select } from '@patternfly/react-core/deprecated';\nexport const x = Select;",
      'src/entities/core/status/view.tsx',
    );

    expect(found.length).toBeGreaterThan(0);
    expect(found[0].message).toMatch(/deprecated entry point is not used/);
  });

  it('keeps the barrel rule for a file under src/entities', async () => {
    const found = await reports(
      "import { x } from 'src/api';\nexport const y = x;",
      'src/entities/core/status/client.ts',
    );

    expect(found).toHaveLength(1);
    expect(found[0].ruleId).toBe('@typescript-eslint/no-restricted-imports');
  });
});

describe('the generated validation module rule', () => {
  const MODULE = '@pulp-ui/sdk/core/models/login/login-response.zod';

  it.each([
    `import { LoginResponse } from '${MODULE}';\nexport const x = LoginResponse;`,
    `import * as login from '${MODULE}';\nexport const x = login;`,
    `import LoginResponse from '${MODULE}';\nexport const x = LoginResponse;`,
    `import { type LoginResponseOutput, LoginResponse } from '${MODULE}';\nexport const x: LoginResponseOutput = LoginResponse;`,
    `export { LoginResponse } from '${MODULE}';`,
    `export * from '${MODULE}';`,
    `export const load = () => import('${MODULE}');`,
  ])('reports %s under src/entities', async (source) => {
    const found = await reports(source, 'src/entities/core/login/model.ts');

    expect(found).toHaveLength(1);
    expect(found[0].ruleId).toBe('no-restricted-syntax');
    expect(found[0].severity).toBe(2);
    expect(found[0].message).toContain(ZOD_MESSAGE);
  });

  it.each([
    `import type { LoginResponse } from '${MODULE}';\nexport type X = LoginResponse;`,
    `import { type LoginResponse } from '${MODULE}';\nexport type X = LoginResponse;`,
    `import { type LoginResponse, type LoginResponseOutput } from '${MODULE}';\nexport type X = [LoginResponse, LoginResponseOutput];`,
    `export type { LoginResponse } from '${MODULE}';`,
  ])('accepts %s', async (source) => {
    expect(await reports(source, 'src/entities/core/login/model.ts')).toEqual(
      [],
    );
  });

  it('accepts a runtime import of an ordinary module of the sdk', async () => {
    expect(
      await reports(
        "import { loginRead } from '@pulp-ui/sdk/core/login';\nexport const x = loginRead;",
        'src/entities/core/status/client.ts',
      ),
    ).toEqual([]);
  });
});

describe('the effective configuration of a source file', () => {
  let rules: Record<string, Linter.RuleEntry>;

  beforeAll(async () => {
    const config = (await eslint.calculateConfigForFile(
      resolve(ROOT, 'src/menu.tsx'),
    )) as Linter.Config;
    rules = config.rules ?? {};
  });

  it('holds the PatternFly list and the deprecated entry point as errors', () => {
    const entry = rules['no-restricted-imports'] as unknown[];
    const text = JSON.stringify(entry);

    expect(entry[0]).toBe(2);
    expect(text).toContain(WRAPPER_MESSAGE);
    expect(text).toContain(TABLE_MESSAGE);
    expect(text).toContain('@patternfly/react-core/deprecated');
    expect(text).not.toContain('src/api');
  });

  it('holds the sdk restriction outside src/entities and not inside', async () => {
    const entities = (await eslint.calculateConfigForFile(
      resolve(ROOT, 'src/entities/core/status/client.ts'),
    )) as Linter.Config;
    const outside = JSON.stringify(rules['no-restricted-imports']);
    const inside = JSON.stringify(entities.rules?.['no-restricted-imports']);

    expect(outside).toContain(SDK_MESSAGE);
    expect(inside).not.toContain(SDK_MESSAGE);
    expect(inside).toContain(WRAPPER_MESSAGE);
    expect(inside).toContain(TABLE_MESSAGE);
    expect(inside).toContain('@patternfly/react-core/deprecated');
  });

  it('holds the barrel list as a warning on its own rule', () => {
    const entry = rules[
      '@typescript-eslint/no-restricted-imports'
    ] as unknown[];
    const text = JSON.stringify(entry);

    expect(entry[0]).toBe(1);
    expect(text).toContain('src/api');
    expect(text).toContain('src/utilities');
    expect(text).toContain('src/actions');
  });
});
