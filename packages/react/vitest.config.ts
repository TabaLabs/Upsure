import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromHere = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Test against the core's source, so tests don't depend on a fresh build.
      "@tabalabs/upsure": fromHere("../core/src/index.ts"),
      // No network in these tests: the core gets the fake tus client from its own tests.
      "tus-js-client": fromHere("../core/test/fake-tus.ts"),
    },
  },
  test: {
    environment: "jsdom",
  },
});
