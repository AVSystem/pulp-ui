import jsEslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import pluginLingui from 'eslint-plugin-lingui';
import pluginReact from 'eslint-plugin-react/configs/recommended.js';
import { defineConfig } from 'eslint/config';
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

export default defineConfig([
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
      'no-restricted-imports': [
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
          ],
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'e2e/**/*.mjs'],
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
    files: ['src/components/patternfly-wrappers/*.{js,jsx,ts,tsx}'],
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
      ],
    },
  },
  {
    files: ['src/**/**/*.{js,jsx,ts,tsx}'],
    rules: {
      'no-restricted-imports': [
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
