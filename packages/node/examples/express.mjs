// Express app that accepts resumable uploads at /uploads.
// Build the package first (`pnpm build`), then run: node examples/express.mjs
import express from "express";
import { createUpsureServer } from "@tabalabs/upsure-node";

const upsure = createUpsureServer({
  path: "/uploads",
  directory: "./uploads",
});

const app = express();

// Mount the upload routes before any body parser, so uploads reach Upsure untouched.
app.all("/uploads", upsure.handle);
app.all("/uploads/:id", upsure.handle);

app.use(express.json());

app.listen(3000, () => {
  console.log("Upload endpoint: http://localhost:3000/uploads");
});
