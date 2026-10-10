import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Upload, type UploadOptions } from "tus-js-client";
import { afterEach } from "vitest";
import { createUpsureServer, type UpsureServer, type UpsureServerOptions } from "../src/index";

export interface TestServer {
  /** Full URL of the upload endpoint. */
  endpoint: string;
  /** Temporary folder the uploads are written to. */
  directory: string;
  upsure: UpsureServer;
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/**
 * Starts an Upsure server on a free port. It is torn down after the test.
 * `mount` can wrap the handler in an app (e.g. Express) instead of serving it directly.
 */
export async function startServer(
  options: Omit<UpsureServerOptions, "path" | "directory"> = {},
  mount: (upsure: UpsureServer) => RequestListener = (upsure) => upsure.handle,
): Promise<TestServer> {
  const directory = await mkdtemp(join(tmpdir(), "upsure-node-"));
  const upsure = createUpsureServer({ ...options, path: "/uploads", directory });
  const server = createServer(mount(upsure));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await upsure.close();
    await rm(directory, { recursive: true, force: true });
  });

  return { endpoint: `http://127.0.0.1:${port}/uploads`, directory, upsure };
}

/** Uploads a buffer with tus-js-client and resolves with the upload URL. */
export function upload(
  endpoint: string,
  data: Buffer,
  options: UploadOptions = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const tusUpload = new Upload(data, {
      endpoint,
      retryDelays: null,
      metadata: { filename: "random.bin", filetype: "application/octet-stream" },
      ...options,
      onError: reject,
      onSuccess: () => resolve(tusUpload.url as string),
    });
    tusUpload.start();
  });
}

export interface CreateRequest {
  /** Declared upload size in bytes. */
  size?: number;
  metadata?: Record<string, string>;
  headers?: Record<string, string>;
}

/** Sends a raw tus creation request, so tests can check the status code. */
export function create(endpoint: string, request: CreateRequest = {}): Promise<Response> {
  const metadata = Object.entries(request.metadata ?? {})
    .map(([key, value]) => `${key} ${Buffer.from(value).toString("base64")}`)
    .join(",");

  return fetch(endpoint, {
    method: "POST",
    headers: {
      "Tus-Resumable": "1.0.0",
      "Upload-Length": String(request.size ?? 16),
      ...(metadata ? { "Upload-Metadata": metadata } : {}),
      ...request.headers,
    },
  });
}
