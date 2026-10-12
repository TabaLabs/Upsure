// Smoke test: starts the example, uploads a small image in a real browser and
// checks that it completes and that the file is in the uploads folder.
// Run with `pnpm test:e2e` from the repo root, after `pnpm build`.
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { start } from "../dev.mjs";

/** A real 1x1 PNG. It has to be real: the server checks the file's content. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Prefers a browser that is already on this machine, so nothing is downloaded:
 * a Chromium that Playwright installed earlier, then Chrome, then Edge.
 */
function findBrowser() {
  const cache =
    process.env.PLAYWRIGHT_BROWSERS_PATH ??
    (process.platform === "win32"
      ? join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "ms-playwright")
      : process.platform === "darwin"
        ? join(homedir(), "Library", "Caches", "ms-playwright")
        : join(homedir(), ".cache", "ms-playwright"));
  const binaries = [
    ["chrome-win64", "chrome.exe"],
    ["chrome-win", "chrome.exe"],
    ["chrome-linux64", "chrome"],
    ["chrome-linux", "chrome"],
    ["chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"],
  ];
  if (existsSync(cache)) {
    const installs = readdirSync(cache)
      .filter((name) => /^chromium-\d+$/.test(name))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const install of installs) {
      for (const parts of binaries) {
        const executablePath = join(cache, install, ...parts);
        if (existsSync(executablePath)) return [{ executablePath }];
      }
    }
  }
  return [{ channel: "chrome" }, { channel: "msedge" }, {}];
}

async function launch() {
  const errors = [];
  for (const options of findBrowser()) {
    try {
      const browser = await chromium.launch(options);
      console.log(`Browser: ${options.executablePath ?? options.channel ?? "Playwright default"}`);
      return browser;
    } catch (error) {
      errors.push(error.message.split("\n")[0]);
    }
  }
  throw new Error(
    `No browser could be started. Install one with "npx playwright install chromium".\n${errors.join("\n")}`,
  );
}

const listUploads = async (directory) =>
  existsSync(directory) ? (await readdir(directory)).filter((name) => !name.endsWith(".json")) : [];

// Ports of their own, so the test also runs while `pnpm example` is open.
const app = await start({ apiPort: 0, webPort: 5183 });
const before = new Set(await listUploads(app.uploads));
let browser;
let created = [];

try {
  browser = await launch();
  const page = await browser.newPage();
  await page.goto(app.url);

  assert.equal(await page.getByRole("heading", { level: 1 }).textContent(), "Upsure example");
  // The stylesheet from @tabalabs/upsure-react is loaded.
  const borderStyle = await page
    .locator(".upsure-dropzone")
    .evaluate((element) => getComputedStyle(element).borderTopStyle);
  assert.equal(borderStyle, "dashed");

  // Choose a file the way a person does: click the dropzone, pick a file.
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Drag files here or click to choose" }).click();
  await (await chooser).setFiles({ name: "pixel.png", mimeType: "image/png", buffer: PNG });

  const file = page.locator(".upsure-file", { hasText: "pixel.png" });
  await file.waitFor();
  await page.locator('.upsure-file[data-status="complete"]').waitFor({ timeout: 15_000 });
  assert.equal(await file.getAttribute("data-status"), "complete");
  assert.match(await file.locator(".upsure-file-status").textContent(), /Uploaded/);

  // The file is in the uploads folder, byte for byte.
  created = (await listUploads(app.uploads)).filter((name) => !before.has(name));
  assert.equal(created.length, 1, "expected exactly one new file in the uploads folder");
  const stored = await readFile(join(app.uploads, created[0]));
  assert.ok(stored.equals(PNG), "the stored file differs from the uploaded image");

  console.log(`PASS: pixel.png reached "complete" and is stored as uploads/${created[0]}`);
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await app.close();
  // Leave the uploads folder the way it was.
  for (const name of created) {
    await rm(join(app.uploads, name), { force: true });
    await rm(join(app.uploads, `${name}.json`), { force: true });
  }
}
