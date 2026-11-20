import jsEslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import pluginLingui from 'eslint-plugin-lingui';
import pluginReact from 'eslint-plugin-react/configs/recommended.js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tsEslint from 'typescript-eslint';
// NOTE: Whilst not fully bundling in ESM, this is needed when importing .json files.
// REF: https://nodejs.org/api/esm.html#json-modules
import pkg from './package.json' with { type: 'json' };

const RESPONSE_MESSAGE =
  'A failed request may have no response (network error, CORS failure). Read the status and text through requestErrorStatus, requestErrorText or requestErrorDescription instead of destructuring the response.';

// Colors come from src/theme/tokens.scss only. A literal color, a PatternFly
// palette, dark or temporary variable and a PatternFly 5 name in a component
// escape the theme swap and the contrast checks.
const COLOR_MESSAGE =
  'Colors come from src/theme/tokens.scss only: use a --pulp-* token or a PatternFly 6 semantic token, and a PatternFly 6 component or class map instead of a hand-written class.';
const COLOR_LITERAL = String.raw`/#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(|--pf-t--color--|--pf-t--global--dark--|--pf-t--temp--|pf-v5-/`;
const COLOR_PROPS =
  '/^(color|background|backgroundColor|borderColor|border|borderTop|borderBottom|borderLeft|borderRight|outline|outlineColor|fill|stroke|boxShadow|textDecorationColor|caretColor)$/';
const SAFE_VALUE = String.raw`/^(var\(--(pulp|pf-t--global)-|inherit$|transparent$|currentColor$|initial$|unset$|none$|0$)/i`;

// The generated validation modules (*.zod) describe the server's schema, which
// marks nearly every field optional and rejects the reduced answers a visitor
// or a later server version produces. They are imported for their types only;
// what runs in the application is the hand-written, tolerant schema of an
// entity.
const ZOD_MESSAGE =
  'Generated .zod modules are imported for types only (import type): validate with the hand-written schema of the entity.';
const ZOD_SOURCE = String.raw`/^@pulp-ui\/sdk\/.*\.zod$/`;

// The generated client is reached through src/entities only: an entity checks
// the shape of every answer and turns the server's addresses into the values a
// screen holds. A screen that calls the generated client directly skips both.
const SDK_PATTERN = {
  group: ['@pulp-ui/sdk', '@pulp-ui/sdk/**'],
  message: 'Import the sdk only from src/entities.',
};

// The framework and the descriptors read and write through src/entities hooks
// only. The older data helpers fetch on their own, outside the query cache and
// the session rules, and the older components fetch per row; both stay for the
// screens that still use them. Pure rule modules and presentational
// components are allowed.
const FRAMEWORK_MESSAGE =
  'The framework reads and writes through src/entities only. Use the hooks of an entity and a component that takes its data as props.';
const LEGACY_UTILITIES = [
  'create-repository',
  'update-repository',
  'delete-repository',
  'repository-distributions',
  'running-sync',
  'wait-for-task',
  'get-repo-url',
  'repository-distro',
  'my-permissions',
];
const LEGACY_COMPONENTS = [
  ['list-page', 'ListPage'],
  ['page', 'Page'],
  ['page-with-tabs', 'PageWithTabs'],
  ['repository-form', 'RepositoryForm'],
  ['remote-form', 'RemoteForm'],
  ['sync-modal', 'SyncModal'],
  ['lazy-distributions', 'LazyDistributions'],
  ['lazy-repositories', 'LazyRepositories'],
  ['delete-repository-modal', 'DeleteRepositoryModal'],
  ['delete-remote-modal', 'DeleteRemoteModal'],
  ['pulp-labels', 'PulpLabels'],
];
const FRAMEWORK_PATTERN = {
  group: [
    'src/api',
    'src/api/**',
    '**/api',
    '**/api/**',
    ...LEGACY_UTILITIES.map((name) => `**/utilities/${name}`),
    ...LEGACY_COMPONENTS.map(([file]) => `**/components/${file}`),
  ],
  message: FRAMEWORK_MESSAGE,
};
const FRAMEWORK_BARREL = {
  name: 'src/components',
  importNames: LEGACY_COMPONENTS.map(([, name]) => name),
  message: FRAMEWORK_MESSAGE,
};

const DEPRECATED_PATTERN = {
  group: [
    '@patternfly/react-core/deprecated/**',
    '@patternfly/react-core/dist/*/deprecated/**',
  ],
  message:
    'Use the PatternFly 6 component; the deprecated entry point is not used.',
};

// The options of no-restricted-imports as one value. A flat-config block that
// sets the options of a rule replaces the options of every earlier block, so
// each block that changes them restates the whole list: the sdk pattern is the
// only part that differs between src/entities and the rest of src.
function importRestrictions({ sdk, framework = false }) {
  return [
    'error',
    {
      paths: [
        {
          importNames: [
            'Alert',
            'Breadcrumb',
            'Chip',
            'ChipGroup',
            'ClipboardCopy',
            'ClipboardCopyButton',
            'FileUpload',
            'Icon',
            'LabelGroup',
            'LoginForm',
            'NavList',
            'Pagination',
            'Popover',
            'SearchInput',
            'Spinner',
            'Tooltip',
          ],
          message: 'Import from src/components instead.',
          name: '@patternfly/react-core',
        },
        {
          importNames: ['Table'],
          message: 'Import Table from src/components instead.',
          name: '@patternfly/react-table',
        },
        {
          name: '@patternfly/react-core/deprecated',
          message:
            'Use the PatternFly 6 component; the deprecated entry point is not used.',
        },
        ...(framework ? [FRAMEWORK_BARREL] : []),
      ],
      patterns: [
        DEPRECATED_PATTERN,
        ...(sdk ? [SDK_PATTERN] : []),
        ...(framework ? [FRAMEWORK_PATTERN] : []),
      ],
    },
  ];
}

export default defineConfig([
  // Generated by the sdk's generation command, never hand-edited.
  globalIgnores([
    'packages/sdk/schema/',
    'packages/sdk/src/{ansible,certguard,core,deb,file,maven,npm,python,rpm}/',
  ]),
  jsEslint.configs.recommended,
  tsEslint.configs.recommended,
  tsEslint.configs.stylistic,
  pluginLingui.configs['flat/recommended'],
  eslintConfigPrettier,
  {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: tsEslint.parser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        // FIXME: This workaround uses the react version within package.json to avoid this plugin calling removed ESLint function in V10.
        // REF: https://github.com/jsx-eslint/eslint-plugin-react/issues/3977
        version: pkg.dependencies.react,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    extends: [
      // NOTE: This is a fix for the workaround using eslint-plugin-react within plugins. All functionality is still achieved by importing fully to `/configs/recommended.js`.
      // REF: https://github.com/jsx-eslint/eslint-plugin-react/issues/3693
      pluginReact,
    ],
    rules: {
      curly: ['error', 'all'],
      'eol-last': ['error', 'always'],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports' },
      ],
      'lingui/no-expression-in-message': 'off',
      'react/react-in-jsx-scope': 'off',
      'no-restricted-imports': importRestrictions({ sdk: false }),
    },
  },
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    rules: { 'no-restricted-imports': importRestrictions({ sdk: true }) },
  },
  {
    files: [
      'src/framework/**/*.{js,jsx,ts,tsx}',
      'src/descriptors/**/*.{js,jsx,ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': importRestrictions({
        sdk: true,
        framework: true,
      }),
    },
  },
  {
    files: ['src/entities/**/*.{js,jsx,ts,tsx}'],
    rules: { 'no-restricted-imports': importRestrictions({ sdk: false }) },
  },
  {
    files: [
      'scripts/**/*.mjs',
      'e2e/**/*.mjs',
      'packages/sdk/scripts/**/*.mjs',
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['config/*.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-var-requires': 'off',
    },
  },
  {
    files: [
      'src/components/patternfly-wrappers/*.{js,jsx,ts,tsx}',
      'src/components/table.tsx',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['e2e/**/*.ts', 'playwright.config.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // A request that never got an answer (network error, CORS failure) has no
    // response, so destructuring it inside a catch handler throws from the
    // handler itself. The request error helpers are the one place that reads
    // the response of a caught error.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/utilities/request-error.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "VariableDeclarator[id.type='ObjectPattern'][init.type='MemberExpression'][init.property.name='response']",
          message: RESPONSE_MESSAGE,
        },
        {
          selector:
            "VariableDeclarator[id.type='ObjectPattern'][init.type='ChainExpression'][init.expression.property.name='response']",
          message: RESPONSE_MESSAGE,
        },
        {
          selector:
            ":function > ObjectPattern.params > Property[key.name='response'][value.type='ObjectPattern']",
          message: RESPONSE_MESSAGE,
        },
        {
          selector: `Literal[value=${COLOR_LITERAL}]`,
          message: COLOR_MESSAGE,
        },
        {
          selector: `TemplateElement[value.raw=${COLOR_LITERAL}]`,
          message: COLOR_MESSAGE,
        },
        {
          selector: `JSXAttribute[name.name='style'] Property[key.name=${COLOR_PROPS}] > Literal[value!=${SAFE_VALUE}]`,
          message: COLOR_MESSAGE,
        },
        {
          selector: `ImportDeclaration[importKind!='type'][source.value=${ZOD_SOURCE}]:has(ImportDefaultSpecifier, ImportNamespaceSpecifier, ImportSpecifier[importKind!='type'])`,
          message: ZOD_MESSAGE,
        },
        {
          selector: `ExportAllDeclaration[exportKind!='type'][source.value=${ZOD_SOURCE}]`,
          message: ZOD_MESSAGE,
        },
        {
          selector: `ExportNamedDeclaration[exportKind!='type'][source.value=${ZOD_SOURCE}]:has(ExportSpecifier[exportKind!='type'])`,
          message: ZOD_MESSAGE,
        },
        {
          selector: `ImportExpression[source.value=${ZOD_SOURCE}]`,
          message: ZOD_MESSAGE,
        },
      ],
    },
  },
  {
    // The barrel list has its own rule name: a block that sets the options of
    // no-restricted-imports would replace the PatternFly list above for every
    // file under src.
    files: ['src/**/**/*.{js,jsx,ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'warn',
        {
          paths: [
            {
              name: 'src/api',
              message: 'Import the specific file and not the barrel.',
            },
            {
              name: 'src/utilities',
              message: 'Import the specific file and not the barrel.',
            },
            {
              name: 'src/actions',
              message: '"Import the specific file and not the barrel."',
            },
          ],
        },
      ],
    },
  },
]);
