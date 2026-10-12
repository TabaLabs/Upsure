import { fileURLToPath } from "node:url";
import { createUpsureServer } from "@tabalabs/upsure-node";
import express from "express";

const GB = 1024 * 1024 * 1024;

/** Uploaded files land in examples/react-node/uploads, which git ignores. */
const uploads = fileURLToPath(new URL("./uploads", import.meta.url));

/** Starts the Express backend. Resolves once it is listening. */
export async function startServer({ port = 3001 } = {}) {
  const upsure = createUpsureServer({
    path: "/uploads",
    directory: uploads,
    maxFileSize: 2 * GB,
    allowedTypes: ["image/*", "application/pdf", ".zip"],
    onUploadComplete(file) {
      console.log(`Upload complete: ${file.name} (${file.size} bytes) -> ${file.path}`);
    },
  });

  const app = express();
  // Mount the upload routes before any body parser, so uploads reach Upsure untouched.
  app.all("/uploads", upsure.handle);
  app.all("/uploads/:id", upsure.handle);
  app.use(express.json());

  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(port, "127.0.0.1", () => resolve(listening));
    listening.once("error", reject);
  });

  return {
    port: server.address().port,
    directory: uploads,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await upsure.close();
    },
  };
}
