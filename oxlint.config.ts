import cloudflare from '@cloudflare/oxlint-config';
import { defineConfig } from 'oxlint';

export default defineConfig({
  extends: [cloudflare],
  env: cloudflare.env,
  ignorePatterns: [
    ...(cloudflare.ignorePatterns ?? []),
    '.next/**',
    'drizzle/**',
    '.worktrees/**',
    'android/**',
  ],
  jsPlugins: ['eslint-plugin-drizzle'],
  rules: {
    // -------------------------------------------------------------------------
    // Project-specific safety rules
    // -------------------------------------------------------------------------
    // Prevent accidental mass-delete/update on Neon production DB.
    // Scoped to "db" and "tx" to avoid false positives on Map.delete(), etc.
    'drizzle/enforce-delete-with-where': [
      'error',
      { drizzleObjectName: ['db', 'tx'] },
    ],
    'drizzle/enforce-update-with-where': [
      'error',
      { drizzleObjectName: ['db', 'tx'] },
    ],

    // Enforce strict equality except idiomatic nullish checks (`== null` / `!= null`)
    eqeqeq: ['error', 'always', { null: 'ignore' }],

    // -------------------------------------------------------------------------
    // Permanently disabled preset rules (intentional project conventions)
    // -------------------------------------------------------------------------
    // Next.js / shadcn/ui & Radix UI idiomatically use `import * as ...`
    'import/no-namespace': 'off',
    // Server routes & operational diagnostics rely on Vercel console logs
    'no-console': 'off',
    // Opinionated style / formatting rules with high churn and low bug-catching ROI
    '@nkzw/no-instanceof': 'off',
    curly: 'off',
    'object-shorthand': 'off',
    'prefer-arrow-callback': 'off',
    'prefer-object-has-own': 'off',
    'quality/no-array-filter-map': 'off',
    'quality/no-conditional-empty-object-spread': 'off',
    'quality/no-object-parameters': 'off',
    'typescript/array-type': 'off',
    'unicorn/catch-error-name': 'off',
    'unicorn/consistent-function-scoping': 'off',
    'unicorn/no-useless-spread': 'off',
    'unicorn/numeric-separators-style': 'off',
    'unicorn/prefer-array-flat-map': 'off',
    'unicorn/prefer-array-some': 'off',
    'unicorn/prefer-at': 'off',
    'unicorn/prefer-dom-node-append': 'off',
    'unicorn/prefer-number-properties': 'off',
    'unicorn/prefer-set-has': 'off',
    'unicorn/prefer-single-call': 'off',
    'unicorn/prefer-string-raw': 'off',
    'unicorn/prefer-string-replace-all': 'off',
    'unicorn/prefer-string-slice': 'off',
    'unicorn/text-encoding-identifier-case': 'off',

    // -------------------------------------------------------------------------
    // Deferred for incremental follow-up PRs
    // -------------------------------------------------------------------------
    // Correctness & React (next highest priority)
    'react/set-state-in-effect': 'off',

    // Import & type hygiene (mostly auto-fixable)
    'import/consistent-type-specifier-style': 'off',
    'typescript/consistent-type-imports': 'off',
    'typescript/no-import-type-side-effects': 'off',
    'typescript/no-unnecessary-type-assertion': 'off',
    'unicorn/prefer-node-protocol': 'off',

    // Strict `any` boundary rules (defer until `rawSql()` and API JSON helpers are typed)
    'quality/no-chained-type-assertions': 'off',
    'quality/no-known-value-widening': 'off',
    'quality/no-unsafe-dictionary-type': 'off',
    'typescript/no-non-null-assertion': 'off',
    'typescript/no-unsafe-argument': 'off',
    'typescript/no-unsafe-assignment': 'off',
    'typescript/no-unsafe-call': 'off',
    'typescript/no-unsafe-member-access': 'off',
    'typescript/no-unsafe-return': 'off',
    'typescript/no-unsafe-type-assertion': 'off',
  },
  overrides: [
    // React 19 / async event handlers (e.g., onClick, onSubmit with react-hook-form)
    {
      files: ['**/*.tsx'],
      rules: {
        'typescript/no-misused-promises': [
          'error',
          { checksVoidReturn: { attributes: false } },
        ],
      },
    },
    // Relax rules for CLI scripts (carried forward from ESLint)
    {
      files: ['scripts/**/*.{ts,mjs,js}'],
      rules: {
        'no-console': 'off',
        'typescript/no-explicit-any': 'off',
        'typescript/use-unknown-in-catch-callback-variable': 'off',
        // Scripts use main().catch(...) entrypoints and legacy sort/path helpers
        'typescript/require-array-sort-compare': 'off',
        'unicorn/prefer-import-meta-properties': 'off',
        'unicorn/prefer-top-level-await': 'off',
      },
    },
    // Relax rules for tests & test helpers (carried forward from ESLint)
    {
      files: ['tests/**/*.{ts,tsx}'],
      rules: {
        'typescript/no-explicit-any': 'off',
        // Scoped to tests so these stay active in production code
        'no-constant-binary-expression': 'off',
        'no-self-compare': 'off',
        'oxc/const-comparisons': 'off',
        'prefer-promise-reject-errors': 'off',
        'quality/no-unknown-returns': 'off',
        'typescript/no-duplicate-type-constituents': 'off',
        'typescript/no-require-imports': 'off',
        'typescript/require-array-sort-compare': 'off',
        'unicorn/prefer-structured-clone': 'off',
        'unicorn/prefer-top-level-await': 'off',
      },
    },
  ],
});
