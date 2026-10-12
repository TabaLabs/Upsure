import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import { afterEach, expect, test } from "vitest";
import { createUploader, type FileState, type Uploader, type UploaderOptions } from "../src/index";
import { startServer } from "./server";

const KB = 1024;
/** 2 MB in 100 KB chunks: enough requests to stop in the middle. */
const SIZE = 2 * 1024 * KB;
const CHUNK_SIZE = 100 * KB;

const uploaders: Uploader[] = [];

afterEach(() => {
  for (const uploader of uploaders.splice(0)) uploader.destroy();
});

function create(options: UploaderOptions): Uploader {
  const uploader = createUploader({ chunkSize: CHUNK_SIZE, retryDelays: [], ...options });
  uploaders.push(uploader);
  return uploader;
}

/** A file with the same name, type, size and date every time, like the same file picked again. */
function makeFile(data: Buffer): File {
  return new File([new Uint8Array(data)], "video.bin", {
    type: "application/octet-stream",
    lastModified: 1_760_000_000_000,
  });
}

/** Resolves with the state of the only file as soon as it matches. */
function waitForFile(uploader: Uploader, matches: (file: FileState) => boolean) {
  return new Promise<FileState>((resolve) => {
    const check = () => {
      const [file] = uploader.getState().files;
      if (!file || !matches(file)) return false;
      unsubscribe();
      resolve(file);
      return true;
    };
    const unsubscribe = uploader.subscribe(check);
    check();
  });
}

/** Calls `act` once, from inside the progress update that passes a quarter of the file. */
function atAQuarter(uploader: Uploader, act: (id: string) => void): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = uploader.subscribe(() => {
      const [file] = uploader.getState().files;
      if (!file || file.status !== "uploading" || file.bytesUploaded < SIZE / 4) return;
      unsubscribe();
      act(file.id);
      resolve();
    });
  });
}

/** The URL of the only upload the server holds. */
async function onlyUploadUrl(server: { endpoint: string; directory: string }): Promise<string> {
  const ids = (await readdir(server.directory)).filter((name) => !name.endsWith(".json"));
  expect(ids).toHaveLength(1);
  return `${server.endpoint}/${ids[0]}`;
}

const storedUploads = () => Object.keys(localStorage).filter((key) => key.startsWith("tus::"));

test("pause then resume continues from the saved offset", async () => {
  const server = await startServer();
  const data = randomBytes(SIZE);
  const uploader = create({ endpoint: server.endpoint });
  const [added] = uploader.addFiles([makeFile(data)]).accepted;
  const id = added?.id as string;

  await atAQuarter(uploader, () => uploader.pause(id));
  const paused = uploader.getState().files[0] as FileState;
  expect(paused.status).toBe("paused");
  expect(paused.bytesUploaded).toBeGreaterThan(0);

  // What the server kept. The HEAD request waits until the cut-off request is fully written.
  const url = await onlyUploadUrl(server);
  const saved = await server.head(url);
  expect(saved.status).toBe(200);
  expect(saved.offset).toBeGreaterThan(0);
  expect(saved.offset).toBeLessThan(SIZE);
  const requestsBeforeResume = server.requests.length;

  uploader.resume(id);
  const done = await waitForFile(uploader, (file) => file.status === "complete");

  // The first data request after resuming starts at the saved offset, not at 0.
  const patches = server.requests.slice(requestsBeforeResume).filter((r) => r.method === "PATCH");
  expect(patches[0]?.offset).toBe(saved.offset);
  expect(patches.every((patch) => (patch.offset as number) >= saved.offset)).toBe(true);
  // Still the same upload on the server.
  expect(done.url).toBe(url);
  expect(server.requests.filter((r) => r.method === "POST")).toHaveLength(1);
  expect((await server.stored(url)).equals(data)).toBe(true);
}, 30_000);

test("cancel deletes the upload on the server", async () => {
  const server = await startServer();
  const uploader = create({ endpoint: server.endpoint });
  uploader.addFiles([makeFile(randomBytes(SIZE))]);

  await atAQuarter(uploader, (id) => uploader.cancel(id));
  // The file is gone from the list right away.
  expect(uploader.getState().files).toEqual([]);

  const deleted = await server.waitForRequest((request) => request.method === "DELETE");
  const url = `${server.endpoint}/${deleted.path.split("/").pop()}`;
  expect(deleted.status).toBe(204);

  expect((await server.head(url)).status).toBe(404);
  expect(await readdir(server.directory)).toEqual([]);
  // Nothing is left behind to resume either.
  expect(storedUploads()).toEqual([]);
}, 30_000);

test("a second uploader with the same file continues from the saved offset, like after a page reload", async () => {
  const server = await startServer();
  const data = randomBytes(SIZE);

  // First page load: the upload gets part of the way, then the page goes away.
  const first = create({ endpoint: server.endpoint });
  first.addFiles([makeFile(data)]);
  await atAQuarter(first, () => first.destroy());
  expect(storedUploads()).toHaveLength(1);

  const url = await onlyUploadUrl(server);
  const saved = await server.head(url);
  expect(saved.offset).toBeGreaterThan(0);
  expect(saved.offset).toBeLessThan(SIZE);
  const requestsBeforeReload = server.requests.length;

  // After the reload: a new uploader, and the user picks the same file again.
  const second = create({ endpoint: server.endpoint });
  second.addFiles([makeFile(data)]);
  const done = await waitForFile(second, (file) => file.status === "complete");

  const afterReload = server.requests.slice(requestsBeforeReload);
  // No new upload was created; the old one was continued from its offset.
  expect(afterReload.filter((r) => r.method === "POST")).toEqual([]);
  expect(afterReload.find((r) => r.method === "PATCH")?.offset).toBe(saved.offset);
  expect(done.url).toBe(url);
  expect((await server.stored(url)).equals(data)).toBe(true);
  // A finished upload is forgotten, so the same file can be uploaded fresh later.
  expect(storedUploads()).toEqual([]);
}, 30_000);

test("with resumeAfterReload off, the same file starts a new upload from zero", async () => {
  const server = await startServer();
  const data = randomBytes(SIZE);
  const options = { endpoint: server.endpoint, resumeAfterReload: false };

  const first = create(options);
  first.addFiles([makeFile(data)]);
  await atAQuarter(first, () => first.destroy());
  expect(storedUploads()).toEqual([]);
  await server.head(await onlyUploadUrl(server));
  const requestsBeforeReload = server.requests.length;

  const second = create(options);
  second.addFiles([makeFile(data)]);
  await waitForFile(second, (file) => file.status === "complete");

  const afterReload = server.requests.slice(requestsBeforeReload);
  expect(afterReload.filter((r) => r.method === "POST")).toHaveLength(1);
  expect(afterReload.find((r) => r.method === "PATCH")?.offset).toBe(0);
}, 30_000);
