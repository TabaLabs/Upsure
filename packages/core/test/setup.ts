import { afterEach } from "vitest";

// Newer Node versions have their own global `localStorage`, which takes
// precedence over jsdom's and prints a warning when it is used. Tests must use
// jsdom's, like code running in a browser would.
declare const jsdom: { window: Window };

Object.defineProperty(globalThis, "localStorage", {
  value: jsdom.window.localStorage,
  configurable: true,
  writable: true,
});

afterEach(() => {
  localStorage.clear();
});
