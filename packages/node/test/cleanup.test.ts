import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, expect, test, vi } from "vitest";
import { createUpsureServer } from "../src/index";
import { create, startServer, upload } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Waits until the folder holds exactly `count` entries, or gives up. */
async function waitForEntries(directory: string, count: number, timeout = 3000) {
  const deadline = Date.now() + timeout;
  let entries = await readdir(directory);
  while (entries.length !== count && Date.now() < deadline) {
    await sleep(25);
    entries = await readdir(directory);
  }
  return entries;
}

test("expired, incomplete uploads are cleaned up", async () => {
  const { endpoint, directory } = await startServer({ expireAfter: 100 });
  await create(endpoint);
  // The partial file and its info file.
  expect(await readdir(directory)).toHaveLength(2);

  expect(await waitForEntries(directory, 0)).toEqual([]);
});

test("finished uploads are kept", async () => {
  const { endpoint, directory } = await startServer({ expireAfter: 100 });
  const url = await upload(endpoint, randomBytes(64));
  const id = url.split("/").pop() as string;
  await create(endpoint);

  const entries = await waitForEntries(directory, 2);
  await sleep(300);

  expect(entries.sort()).toEqual([id, `${id}.json`]);
  expect((await readdir(directory)).sort()).toEqual([id, `${id}.json`]);
});

test("close() stops the cleanup timer", async () => {
  const { endpoint, directory, upsure } = await startServer({ expireAfter: 100 });

  await upsure.close();
  await create(endpoint);
  await sleep(500);

  expect(await readdir(directory)).toHaveLength(2);
});

test("the cleanup timer is unref()'d and runs at most hourly by default", async () => {
  const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
  const directory = await mkdtemp(join(tmpdir(), "upsure-node-"));

  const upsure = createUpsureServer({ path: "/uploads", directory });

  expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  const timer = setIntervalSpy.mock.results[0]?.value as NodeJS.Timeout;
  expect(timer.hasRef()).toBe(false);
  expect(setIntervalSpy.mock.calls[0]?.[1]).toBe(60 * 60 * 1000);

  await upsure.close();
  await rm(directory, { recursive: true, force: true });
});

test("expireAfter: 0 turns the cleanup off", async () => {
  const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
  const directory = await mkdtemp(join(tmpdir(), "upsure-node-"));

  const upsure = createUpsureServer({ path: "/uploads", directory, expireAfter: 0 });

  expect(setIntervalSpy).not.toHaveBeenCalled();

  await upsure.close();
  await rm(directory, { recursive: true, force: true });
});
