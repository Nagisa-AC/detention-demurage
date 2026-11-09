// @ts-check
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

const boundaryMessage = "dd-core must not import packages/extract.";

export default defineConfig(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "packages/dd-core/eslint-fixtures/**",
    ],
  },
  {
    files: ["**/*.ts"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },
  {
    files: ["packages/dd-core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "dd-extract",
              message: boundaryMessage,
            },
          ],
          patterns: [
            {
              group: [
                "dd-extract/*",
                "**/packages/extract",
                "**/packages/extract/**",
              ],
              message: boundaryMessage,
            },
            {
              regex: "(?:^|/)(?:\\.\\./)+extract(?:/|$)",
              caseSensitive: true,
              message: boundaryMessage,
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression",
          message: "dd-core must not use dynamic import.",
        },
      ],
      "@typescript-eslint/no-require-imports": "error",
    },
  },
  {
    files: [
      "packages/dd-core/src/normalize/money.ts",
      "packages/dd-core/eslint-fixtures/money-float.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression",
          message: "dd-core must not use dynamic import.",
        },
        {
          selector: "Literal[raw=/^(?:\\d+\\.\\d*|\\.\\d+)/]",
          message: "money.ts must not use a float.",
        },
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message: "money.ts must not use a float.",
        },
        {
          selector: "CallExpression[callee.name='Number']",
          message: "money.ts must not use a float.",
        },
        {
          selector:
            "CallExpression[callee.object.name='Number'][callee.property.name='parseFloat']",
          message: "money.ts must not use a float.",
        },
      ],
    },
  },
);
