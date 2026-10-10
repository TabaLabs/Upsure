import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type DetailedError, Upload, type UploadOptions } from "tus-js-client";
import { expect, test } from "vitest";
import { startServer } from "./helpers";
import { startProxy } from "./proxy";

const KB = 1024;
const MB = 1024 * KB;

/** About 5 MB, and not a multiple of the chunk size, so the last chunk is a partial one. */
const SIZE = 5 * MB + 12345;
const CHUNK_SIZE = 256 * KB;
/** Cut the connection in the middle of the 11th chunk. */
const DROP_AFTER = 10 * CHUNK_SIZE + 100 * KB;
/** Generous allowance for the HTTP headers of every request of an upload. */
const HEADER_OVERHEAD = 64 * KB;

interface Attempt {
  /** Resolves when the upload succeeds, rejects with the tus error when it fails. */
  done: Promise<void>;
  /** The `Upload-Offset` of every PATCH request the client sent, in order. */
  patchOffsets: number[];
  /** Bytes the server has acknowledged to the client so far. */
  accepted(): number;
  /** The upload URL the server assigned. */
  url(): string;
}

function startUpload(data: Buffer, options: UploadOptions): Attempt {
  const patchOffsets: number[] = [];
  let accepted = 0;
  let tusUpload: Upload;

  const done = new Promise<void>((resolve, reject) => {
    tusUpload = new Upload(data, {
      chunkSize: CHUNK_SIZE,
      retryDelays: null,
      metadata: { filename: "random.bin", filetype: "application/octet-stream" },
      ...options,
      onBeforeRequest(request) {
        if (request.getMethod() === "PATCH") {
          patchOffsets.push(Number(request.getHeader("Upload-Offset")));
        }
      },
      onChunkComplete(_chunkSize, bytesAccepted) {
        accepted = bytesAccepted;
      },
      onError: reject,
      onSuccess: () => resolve(),
    });
    tusUpload.start();
  });

  return { done, patchOffsets, accepted: () => accepted, url: () => tusUpload.url as string };
}

/** Asks the server how many bytes of an upload it has stored. */
async function headOffset(url: string): Promise<number> {
  const response = await fetch(url, { method: "HEAD", headers: { "Tus-Resumable": "1.0.0" } });
  expect(response.status).toBe(200);
  return Number(response.headers.get("upload-offset"));
}

async function storedFile(directory: string, url: string): Promise<Buffer> {
  return readFile(join(directory, url.split("/").pop() as string));
}

test("an upload continues from the saved offset after the connection drops", async () => {
  const server = await startServer();
  const proxy = await startProxy(server.port);
  const data = randomBytes(SIZE);

  // Start the upload and cut the connection in the middle of it.
  proxy.dropAfter(DROP_AFTER);
  const first = startUpload(data, { endpoint: proxy.endpoint });
  const error = (await first.done.catch((reason) => reason)) as DetailedError;
  expect(error).toBeInstanceOf(Error);
  // A network failure, not an answer from the server.
  expect(error.originalResponse).toBeNull();
  expect(proxy.drops()).toBe(1);
  const url = first.url();

  // The server kept what it received.
  const savedOffset = await headOffset(url);
  expect(savedOffset).toBeGreaterThan(0);
  expect(savedOffset).toBeLessThan(SIZE);
  expect(savedOffset).toBeGreaterThanOrEqual(first.accepted());

  // Continue with the same upload URL.
  const sentBeforeResume = proxy.bytesSent();
  const second = startUpload(data, { uploadUrl: url });
  await second.done;

  // It starts from the saved offset, not from zero...
  expect(second.patchOffsets[0]).toBe(savedOffset);
  // ...and only sends what was missing.
  const sentAfterResume = proxy.bytesSent() - sentBeforeResume;
  expect(sentAfterResume).toBeGreaterThanOrEqual(SIZE - savedOffset);
  expect(sentAfterResume).toBeLessThan(SIZE - savedOffset + HEADER_OVERHEAD);

  expect(second.url()).toBe(url);
  expect((await storedFile(server.directory, url)).equals(data)).toBe(true);
}, 30_000);

test("an upload continues after the server restarts", async () => {
  const firstServer = await startServer();
  // The proxy stands in for the server's stable address, so the upload URL
  // stays the same while the server behind it is replaced.
  const proxy = await startProxy(firstServer.port);
  const data = randomBytes(SIZE);

  // Upload part of the file.
  proxy.dropAfter(DROP_AFTER);
  const first = startUpload(data, { endpoint: proxy.endpoint });
  await first.done.catch(() => {});
  const url = first.url();
  const uploadPath = new URL(url).pathname;
  // Asking the server directly waits until it has finished writing the part it received.
  const offsetBeforeRestart = await headOffset(`http://127.0.0.1:${firstServer.port}${uploadPath}`);
  expect(offsetBeforeRestart).toBeGreaterThan(0);
  expect(offsetBeforeRestart).toBeLessThan(SIZE);

  // Close the server completely: nothing answers at the upload URL any more.
  await firstServer.stop();
  await expect(
    fetch(url, { method: "HEAD", headers: { "Tus-Resumable": "1.0.0" } }),
  ).rejects.toThrow();

  // A new server on the same storage directory knows the upload and its offset.
  const secondServer = await startServer({ directory: firstServer.directory });
  proxy.setTarget(secondServer.port);
  expect(await headOffset(url)).toBe(offsetBeforeRestart);

  // Continue with the same upload URL.
  const second = startUpload(data, { uploadUrl: url });
  await second.done;

  expect(second.patchOffsets[0]).toBe(offsetBeforeRestart);
  expect((await storedFile(secondServer.directory, url)).equals(data)).toBe(true);
}, 30_000);

test("tus-js-client retries on its own after the connection drops", async () => {
  const server = await startServer();
  const proxy = await startProxy(server.port);
  const data = randomBytes(SIZE);

  // One upload, no manual resume: the client has to recover by itself.
  proxy.dropAfter(DROP_AFTER);
  const attempt = startUpload(data, { endpoint: proxy.endpoint, retryDelays: [0, 100, 500] });
  await attempt.done;

  expect(proxy.drops()).toBe(1);
  // Only the very first PATCH starts at zero; the retry picks up where the server was.
  expect(attempt.patchOffsets.filter((offset) => offset === 0)).toHaveLength(1);
  // The file was not sent twice: at most the interrupted chunk is repeated.
  expect(proxy.bytesSent()).toBeLessThan(SIZE + CHUNK_SIZE + HEADER_OVERHEAD);

  expect((await storedFile(server.directory, attempt.url())).equals(data)).toBe(true);
}, 30_000);
