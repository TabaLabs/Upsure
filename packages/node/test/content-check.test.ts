import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DetailedError } from "tus-js-client";
import { expect, test, vi } from "vitest";
import { startServer, upload } from "./helpers";

/** A real 1x1 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** A Windows executable header ("MZ") followed by junk. */
const EXE = Buffer.concat([Buffer.from("MZ\u0090\u0000", "latin1"), randomBytes(256)]);

const withHeader = (header: number[] | string) =>
  Buffer.concat([
    typeof header === "string" ? Buffer.from(header, "latin1") : Buffer.from(header),
    randomBytes(64),
  ]);

test("a real png passes", async () => {
  const { endpoint, directory } = await startServer();

  const url = await upload(endpoint, PNG, {
    metadata: { filename: "pixel.png", filetype: "image/png" },
  });

  const stored = await readFile(join(directory, url.split("/").pop() as string));
  expect(stored.equals(PNG)).toBe(true);
});

test("a fake png is rejected with 415 and deleted", async () => {
  const onUploadComplete = vi.fn();
  const { endpoint, directory } = await startServer({ onUploadComplete });

  const error = (await upload(endpoint, EXE, {
    metadata: { filename: "setup.png", filetype: "image/png" },
  }).catch((reason) => reason)) as DetailedError;

  expect(error.originalResponse?.getStatus()).toBe(415);
  expect(await readdir(directory)).toEqual([]);
  expect(onUploadComplete).not.toHaveBeenCalled();
});

test("the file extension is checked when no filetype is sent", async () => {
  const { endpoint } = await startServer();

  const error = (await upload(endpoint, EXE, {
    metadata: { filename: "setup.PNG" },
  }).catch((reason) => reason)) as DetailedError;

  expect(error.originalResponse?.getStatus()).toBe(415);
});

test("an unknown type passes without a content check", async () => {
  const { endpoint, directory } = await startServer();

  const url = await upload(endpoint, EXE, {
    metadata: { filename: "data.bin", filetype: "application/octet-stream" },
  });

  const stored = await readFile(join(directory, url.split("/").pop() as string));
  expect(stored.equals(EXE)).toBe(true);
});

test.each([
  ["image/jpeg", withHeader([0xff, 0xd8, 0xff, 0xe0])],
  ["image/gif", withHeader("GIF89a")],
  ["image/webp", withHeader("RIFF$\u0000\u0000\u0000WEBP")],
  ["application/pdf", withHeader("%PDF-1.7\n")],
])("%s content is recognized", async (filetype, data) => {
  const { endpoint } = await startServer();

  await expect(upload(endpoint, data, { metadata: { filetype } })).resolves.toBeTypeOf("string");
});

test.each(["image/jpeg", "image/gif", "image/webp", "application/pdf"])(
  "%s with the wrong content is rejected with 415",
  async (filetype) => {
    const { endpoint } = await startServer();

    const error = (await upload(endpoint, EXE, { metadata: { filetype } }).catch(
      (reason) => reason,
    )) as DetailedError;

    expect(error.originalResponse?.getStatus()).toBe(415);
  },
);
