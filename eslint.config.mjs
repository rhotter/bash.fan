import js from "@eslint/js";
import tseslint from "typescript-eslint";
import drizzle from "eslint-plugin-drizzle";
import reactHooks from "eslint-plugin-react-hooks";

/** @type {import('eslint').Linter.Config[]} */
export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      drizzle,
      "react-hooks": reactHooks,
    },
    rules: {
      // React Hooks rules
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/rules-of-hooks": "error",

      // Prevent accidental mass-delete/update on Neon production DB.
      // Scoped to "db" and "tx" to avoid false positives on Map.delete(), etc.
      "drizzle/enforce-delete-with-where": [
        "error",
        { drizzleObjectName: ["db", "tx"] },
      ],
      "drizzle/enforce-update-with-where": [
        "error",
        { drizzleObjectName: ["db", "tx"] },
      ],

      // Allow unused vars prefixed with _ (common pattern for destructuring)
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // Allow `any` in existing codebase (can tighten later)
      "@typescript-eslint/no-explicit-any": "warn",

      // Allow require() imports in config files
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Relax rules for scripts and tests (non-production code)
  {
    files: ["scripts/**/*.ts", "tests/**/*.ts"],
    rules: {
      "no-useless-assignment": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    ignores: [".next/", "node_modules/", "drizzle/", ".worktrees/"],
  },
];
