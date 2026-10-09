// Plain `http` server that accepts resumable uploads at /uploads.
// Build the package first (`pnpm build`), then run: node examples/plain-http.mjs
import { createServer } from "node:http";
import { createUpsureServer } from "@tabalabs/upsure-node";

const upsure = createUpsureServer({
  path: "/uploads",
  directory: "./uploads",
});

const server = createServer((req, res) => {
  if (req.url === "/uploads" || req.url?.startsWith("/uploads/")) {
    upsure.handle(req, res);
    return;
  }
  res.writeHead(404).end("Not found");
});

server.listen(3000, () => {
  console.log("Upload endpoint: http://localhost:3000/uploads");
});
