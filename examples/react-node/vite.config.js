import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Port of the Express server from server.mjs. */
const apiPort = Number(process.env.API_PORT ?? 3001);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // The browser only ever talks to Vite, so there is no CORS to set up.
      // `changeOrigin` stays off on purpose: the Express server then sees the
      // browser's Host header and returns upload URLs that point back at Vite.
      "/uploads": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false },
    },
  },
});
