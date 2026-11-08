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
          ],
        },
      ],
      "@typescript-eslint/no-require-imports": "error",
    },
  },
);
