import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Upload } from "tus-js-client";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createUpsureServer } from "../src/index";

let directory: string;
let server: Server;
let endpoint: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "upsure-node-"));
  const upsure = createUpsureServer({ path: "/uploads", directory });
  server = createServer(upsure.handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  endpoint = `http://127.0.0.1:${port}/uploads`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
});

/** Uploads a buffer with tus-js-client and resolves with the upload URL. */
function upload(data: Buffer, chunkSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const tusUpload = new Upload(data, {
      endpoint,
      chunkSize,
      retryDelays: null,
      metadata: { filename: "random.bin", filetype: "application/octet-stream" },
      onError: reject,
      onSuccess: () => resolve(tusUpload.url as string),
    });
    tusUpload.start();
  });
}

test("a file uploaded with tus-js-client lands in the folder byte for byte", async () => {
  // 1 MB in 256 KB chunks, so the upload takes several PATCH requests.
  const data = randomBytes(1024 * 1024);

  const url = await upload(data, 256 * 1024);

  const id = url.split("/").pop() as string;
  const stored = await readFile(join(directory, id));
  expect(stored.length).toBe(data.length);
  expect(stored.equals(data)).toBe(true);
});
