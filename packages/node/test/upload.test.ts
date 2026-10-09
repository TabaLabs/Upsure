import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { startServer, upload } from "./helpers";

test("a file uploaded with tus-js-client lands in the folder byte for byte", async () => {
  const { endpoint, directory } = await startServer();
  // 1 MB in 256 KB chunks, so the upload takes several PATCH requests.
  const data = randomBytes(1024 * 1024);

  const url = await upload(endpoint, data, { chunkSize: 256 * 1024 });

  const id = url.split("/").pop() as string;
  const stored = await readFile(join(directory, id));
  expect(stored.length).toBe(data.length);
  expect(stored.equals(data)).toBe(true);
});
