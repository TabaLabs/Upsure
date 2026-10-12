import { describe, expect, test } from "vitest";
import { startServer } from "./helpers";

const APP = "http://localhost:5173";
const OTHER = "https://evil.example";

/** Sends a tus creation request the way a page on `origin` would. */
function createFrom(endpoint: string, origin?: string): Promise<Response> {
  return fetch(endpoint, {
    method: "POST",
    headers: { "Tus-Resumable": "1.0.0", "Upload-Length": "16", ...(origin ? { Origin: origin } : {}) },
  });
}

/** The CORS preflight a browser sends before a cross-origin upload request. */
function preflightFrom(endpoint: string, origin: string): Promise<Response> {
  return fetch(endpoint, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "tus-resumable,upload-length",
    },
  });
}

const allowOrigin = (response: Response) => response.headers.get("access-control-allow-origin");

describe("allowedOrigins", () => {
  test("without it, pages from every website may upload", async () => {
    const { endpoint } = await startServer();

    expect(allowOrigin(await preflightFrom(endpoint, OTHER))).toBe("*");
    expect(allowOrigin(await createFrom(endpoint, OTHER))).toBe("*");
  });

  test("an allowed origin is let through, on the preflight and on the request", async () => {
    const { endpoint } = await startServer({ allowedOrigins: [APP, "https://app.example"] });

    expect(allowOrigin(await preflightFrom(endpoint, APP))).toBe(APP);
    const created = await createFrom(endpoint, APP);
    expect(created.status).toBe(201);
    expect(allowOrigin(created)).toBe(APP);
    expect(allowOrigin(await preflightFrom(endpoint, "https://app.example"))).toBe(
      "https://app.example",
    );
  });

  test("another origin never gets permission, so a browser blocks its page", async () => {
    const { endpoint } = await startServer({ allowedOrigins: [APP] });

    // A browser only lets a page read the response, or send the real upload
    // request at all, when this header names the page's own origin or "*".
    for (const response of [await preflightFrom(endpoint, OTHER), await createFrom(endpoint, OTHER)]) {
      expect(allowOrigin(response)).not.toBe(OTHER);
      expect(allowOrigin(response)).not.toBe("*");
    }
  });

  test("it is not authentication: a request without an Origin header still works", async () => {
    const { endpoint } = await startServer({ allowedOrigins: [APP] });

    expect((await createFrom(endpoint)).status).toBe(201);
  });
});
