import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Tests run in Node, where tus-js-client would load its Node build, which
      // doesn't accept File/Blob. Use the browser build, like a real app does.
      "tus-js-client": "tus-js-client/lib.es5/browser/index.js",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
  },
});
