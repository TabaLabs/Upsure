import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import express from "express";
import { expect, test } from "vitest";
import { startServer, upload } from "./helpers";

test("a full upload works through Express routes", async () => {
  const { endpoint, directory } = await startServer({}, (upsure) => {
    const app = express();
    app.all("/uploads", upsure.handle);
    app.all("/uploads/:id", upsure.handle);
    // Body parsers go after the upload routes, so they never consume an upload.
    app.use(express.json());
    return app;
  });
  // 1 MB in 256 KB chunks, so the upload takes several PATCH requests.
  const data = randomBytes(1024 * 1024);

  const url = await upload(endpoint, data, { chunkSize: 256 * 1024 });

  const id = url.split("/").pop() as string;
  expect(url).toBe(`${endpoint}/${id}`);
  const stored = await readFile(join(directory, id));
  expect(stored.equals(data)).toBe(true);
});
