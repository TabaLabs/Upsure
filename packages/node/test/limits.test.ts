import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import type { CompletedUpload } from "../src/index";
import { create, startServer, upload } from "./helpers";

const TUS_HEADERS = { "Tus-Resumable": "1.0.0" };

describe("maxFileSize", () => {
  test("rejects an upload over the limit with 413", async () => {
    const { endpoint } = await startServer({ maxFileSize: 1000 });

    const response = await create(endpoint, { size: 1001 });

    expect(response.status).toBe(413);
  });

  test("accepts an upload exactly at the limit", async () => {
    const { endpoint } = await startServer({ maxFileSize: 1000 });

    const response = await create(endpoint, { size: 1000 });

    expect(response.status).toBe(201);
  });
});

describe("allowedTypes", () => {
  const allowedTypes = ["image/*", "application/pdf", ".zip"];

  test.each([
    ["a MIME wildcard", { filetype: "image/png", filename: "photo.png" }],
    ["an exact MIME type", { filetype: "application/pdf", filename: "report" }],
    ["an extension", { filetype: "application/octet-stream", filename: "Archive.ZIP" }],
    ["an extension with no filetype", { filename: "archive.zip" }],
  ])("accepts a file matching %s", async (_label, metadata) => {
    const { endpoint } = await startServer({ allowedTypes });

    const response = await create(endpoint, { metadata });

    expect(response.status).toBe(201);
  });

  test.each([
    ["another type", { filetype: "text/plain", filename: "notes.txt" }],
    ["a type that only shares the wildcard prefix", { filetype: "imagex/png", filename: "a.bin" }],
    ["a name that merely contains the extension", { filename: "archive.zip.exe" }],
  ])("rejects %s with 415", async (_label, metadata) => {
    const { endpoint } = await startServer({ allowedTypes });

    const response = await create(endpoint, { metadata });

    expect(response.status).toBe(415);
  });

  test("rejects an upload with no metadata with 415", async () => {
    const { endpoint } = await startServer({ allowedTypes });

    const response = await create(endpoint);

    expect(response.status).toBe(415);
  });
});

describe("authorize", () => {
  const authorize = (request: Request) => request.headers.get("authorization") === "Bearer secret";

  test("rejects a request with 401 when it returns false", async () => {
    const { endpoint } = await startServer({ authorize });

    const response = await create(endpoint);

    expect(response.status).toBe(401);
  });

  test("lets the request through when it returns true", async () => {
    const { endpoint } = await startServer({ authorize });

    const response = await create(endpoint, { headers: { Authorization: "Bearer secret" } });

    expect(response.status).toBe(201);
  });

  test("supports an async function", async () => {
    const { endpoint } = await startServer({ authorize: async () => false });

    const response = await create(endpoint);

    expect(response.status).toBe(401);
  });

  test("also guards requests to an existing upload", async () => {
    const { endpoint } = await startServer({ authorize });
    const created = await create(endpoint, { headers: { Authorization: "Bearer secret" } });
    const url = created.headers.get("location") as string;

    const head = await fetch(url, { method: "HEAD", headers: TUS_HEADERS });
    const patch = await fetch(url, {
      method: "PATCH",
      headers: {
        ...TUS_HEADERS,
        "Upload-Offset": "0",
        "Content-Type": "application/offset+octet-stream",
      },
      body: "0123456789abcdef",
    });

    expect(head.status).toBe(401);
    expect(patch.status).toBe(401);
  });
});

describe("onUploadComplete", () => {
  test("is called once with the finished file", async () => {
    const onUploadComplete = vi.fn<(file: CompletedUpload) => void>();
    const { endpoint, directory } = await startServer({ onUploadComplete });
    const data = randomBytes(300 * 1024);

    const url = await upload(endpoint, data, {
      chunkSize: 100 * 1024,
      metadata: { filename: "holiday.png", filetype: "image/png", album: "summer" },
    });

    const id = url.split("/").pop() as string;
    expect(onUploadComplete).toHaveBeenCalledTimes(1);
    const file = onUploadComplete.mock.calls[0]?.[0] as CompletedUpload;
    expect(file).toEqual({
      id,
      name: "holiday.png",
      type: "image/png",
      size: data.length,
      path: join(directory, id),
      metadata: { filename: "holiday.png", filetype: "image/png", album: "summer" },
    });
    expect(isAbsolute(file.path)).toBe(true);
    expect((await readFile(file.path)).equals(data)).toBe(true);
  });

  test("sanitizes the file name", async () => {
    const onUploadComplete = vi.fn<(file: CompletedUpload) => void>();
    const { endpoint } = await startServer({ onUploadComplete });

    await upload(endpoint, randomBytes(64), {
      metadata: { filename: '..\\../etc/ pass:w"or?d\u0000.txt ', filetype: "text/plain" },
    });

    expect(onUploadComplete.mock.calls[0]?.[0].name).toBe("password.txt");
  });

  test("falls back to the id when no usable name is sent", async () => {
    const onUploadComplete = vi.fn<(file: CompletedUpload) => void>();
    const { endpoint } = await startServer({ onUploadComplete });

    const url = await upload(endpoint, randomBytes(64), { metadata: { filename: "../.." } });

    const file = onUploadComplete.mock.calls[0]?.[0] as CompletedUpload;
    expect(file.name).toBe(url.split("/").pop());
    expect(file.type).toBe("application/octet-stream");
  });

  test("is not called for an upload that was only created", async () => {
    const onUploadComplete = vi.fn();
    const { endpoint } = await startServer({ onUploadComplete });

    await create(endpoint);

    expect(onUploadComplete).not.toHaveBeenCalled();
  });
});
