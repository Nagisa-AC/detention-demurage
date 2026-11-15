import { transformSync } from "esbuild";
import { defineConfig } from "vitest/config";

// The test runner's parser rejects JSX, including files under a Next.js route group.
export default defineConfig({
  plugins: [
    {
      name: "dd-tsx",
      enforce: "pre",
      transform(code, id) {
        const file = id.split("?")[0] ?? id;
        if (!file.endsWith(".tsx")) return null;
        const result = transformSync(code, {
          loader: "tsx",
          jsx: "automatic",
          format: "esm",
          sourcefile: file,
        });
        return { code: result.code, map: result.map };
      },
    },
  ],
  test: {
    environment: "node",
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
      "fixtures/synthetic/**/*.test.ts",
      "evals/**/*.test.ts",
    ],
  },
});
