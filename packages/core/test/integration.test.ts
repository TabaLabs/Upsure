import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUpsureServer, type UpsureServerOptions } from "@tabalabs/upsure-node";
import { afterEach, expect, test } from "vitest";
import { createUploader, type FileState, type UploaderOptions } from "../src/index";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** Starts a real Upsure server on a free port. It is torn down after the test. */
async function startServer(options: Partial<UpsureServerOptions> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "upsure-core-"));
  const upsure = createUpsureServer({ ...options, path: "/uploads", directory });
  const server = createServer(upsure.handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await upsure.close();
    await rm(directory, { recursive: true, force: true });
  });

  return { endpoint: `http://127.0.0.1:${port}/uploads`, directory };
}

/** Uploads one file through createUploader and resolves with its final state. */
function uploadFile(file: File, options: UploaderOptions) {
  return new Promise<{ file: FileState; error?: Error; seen: FileState[] }>((resolve) => {
    const seen: FileState[] = [];
    const uploader = createUploader({
      retryDelays: [],
      ...options,
      onComplete: (state) => resolve({ file: state, seen }),
      onError: (state, error) => resolve({ file: state, error, seen }),
    });
    uploader.subscribe(() => {
      const [state] = uploader.getState().files;
      if (state) seen.push(state);
    });
    uploader.addFiles([file]);
  });
}

test("a file uploaded through createUploader arrives byte for byte", async () => {
  const { endpoint, directory } = await startServer();
  const data = randomBytes(300 * 1024);
  const file = new File([new Uint8Array(data)], "random.bin", { type: "application/octet-stream" });

  // 100 KB chunks, so the upload takes several requests.
  const result = await uploadFile(file, { endpoint, chunkSize: 100 * 1024 });

  expect(result.error).toBeUndefined();
  expect(result.file).toMatchObject({
    name: "random.bin",
    size: data.length,
    status: "complete",
    progress: 1,
    bytesUploaded: data.length,
  });
  expect(result.file.url).toMatch(new RegExp(`^${endpoint}/[0-9a-f]+$`));

  const id = (result.file.url as string).split("/").pop() as string;
  const stored = await readFile(join(directory, id));
  expect(stored.equals(data)).toBe(true);

  // It went queued → uploading → complete, with progress in between.
  const statuses = result.seen.map((state) => state.status);
  expect([...new Set(statuses)]).toEqual(["queued", "uploading", "complete"]);
  expect(result.seen.some((state) => state.progress > 0 && state.progress < 1)).toBe(true);
});

test("the server receives filename, filetype, custom metadata and headers", async () => {
  const received: Array<Record<string, string | null>> = [];
  const { endpoint } = await startServer({
    authorize: (request) => request.headers.get("authorization") === "Bearer secret",
    onUploadComplete: (upload) => {
      received.push(upload.metadata);
    },
  });
  const file = new File(["hello world"], "hello.txt", { type: "text/plain" });

  const result = await uploadFile(file, {
    endpoint,
    headers: () => ({ Authorization: "Bearer secret" }),
    metadata: { album: "summer" },
  });

  expect(result.file.status).toBe("complete");
  expect(received).toEqual([{ album: "summer", filename: "hello.txt", filetype: "text/plain" }]);
});

test("a 415 rejection gives status error with retryable false", async () => {
  const { endpoint, directory } = await startServer({ allowedTypes: ["image/*"] });
  const file = new File(["not an image"], "notes.txt", { type: "text/plain" });

  const result = await uploadFile(file, { endpoint });

  expect(result.file).toMatchObject({
    status: "error",
    error: "File type not allowed",
    retryable: false,
  });
  expect(result.file.url).toBeUndefined();
  expect(result.error).toBeInstanceOf(Error);
  expect(await readdir(directory)).toEqual([]);
});

test("a server that can't be reached gives status error with retryable true", async () => {
  const { endpoint } = await startServer();
  // Shut the server down, so the address is known to be dead.
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  const file = new File(["hello"], "hello.txt", { type: "text/plain" });

  const result = await uploadFile(file, { endpoint });

  expect(result.file).toMatchObject({ status: "error", retryable: true });
});
