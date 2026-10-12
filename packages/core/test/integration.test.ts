import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import { expect, test } from "vitest";
import { createUploader, type FileState, type UploaderOptions } from "../src/index";
import { startServer } from "./server";

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
  const { endpoint, stored } = await startServer();
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

  expect((await stored(result.file.url as string)).equals(data)).toBe(true);

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
  const { endpoint, stop } = await startServer();
  // Shut the server down, so the address is known to be dead.
  await stop();
  const file = new File(["hello"], "hello.txt", { type: "text/plain" });

  const result = await uploadFile(file, { endpoint });

  expect(result.file).toMatchObject({ status: "error", retryable: true });
});
