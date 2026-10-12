import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer as createViteServer } from "vite";
import { startServer } from "./server.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));

/**
 * Starts the Express backend and the Vite dev server together. Vite serves the
 * page and proxies /uploads to Express (see vite.config.js).
 */
export async function start({ apiPort = 3001, webPort = 5173 } = {}) {
  const api = await startServer({ port: apiPort });
  // vite.config.js reads this to know where to proxy /uploads.
  process.env.API_PORT = String(api.port);

  const web = await createViteServer({ root, server: { port: webPort } });
  await web.listen();

  return {
    url: web.resolvedUrls?.local[0] ?? `http://localhost:${webPort}/`,
    apiPort: api.port,
    uploads: api.directory,
    async close() {
      await web.close();
      await api.close();
    },
  };
}

// Run directly (`node dev.mjs`, `pnpm example`): start and keep running until Ctrl+C.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await start();
  console.log(`\n  Upsure example:  ${app.url}`);
  console.log(`  Upload server:   http://127.0.0.1:${app.apiPort}/uploads`);
  console.log(`  Files are saved: ${app.uploads}\n`);
}
