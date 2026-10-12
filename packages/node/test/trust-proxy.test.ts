import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { create, onCleanup, startServer, upload } from "./helpers";

/** What a proxy such as nginx adds for a site served at https://files.example.com. */
const FORWARDED = { "X-Forwarded-Proto": "https", "X-Forwarded-Host": "files.example.com" };

/** The upload URL the server returns, with the id replaced so it is easy to compare. */
async function locationFor(endpoint: string, headers: Record<string, string>): Promise<string> {
  const response = await create(endpoint, { headers });
  expect(response.status).toBe(201);
  return (response.headers.get("location") as string).replace(/\/[0-9a-f]+$/, "/<id>");
}

/**
 * A minimal reverse proxy: it passes every request on to `targetPort`, sets
 * the Host header to the backend's and reports the address the client used in
 * `X-Forwarded-Host`, like nginx does. It is torn down after the test.
 */
async function startReverseProxy(targetPort: number) {
  const requests: string[] = [];
  const proxy = createServer((clientRequest, clientResponse) => {
    requests.push(`${clientRequest.method} ${clientRequest.url}`);
    const upstream = request(
      {
        host: "127.0.0.1",
        port: targetPort,
        method: clientRequest.method,
        path: clientRequest.url,
        headers: {
          ...clientRequest.headers,
          host: `127.0.0.1:${targetPort}`,
          "x-forwarded-host": clientRequest.headers.host,
          "x-forwarded-proto": "http",
        },
      },
      (upstreamResponse) => {
        clientResponse.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(clientResponse);
      },
    );
    upstream.on("error", () => clientResponse.destroy());
    clientRequest.pipe(upstream);
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const { port } = proxy.address() as AddressInfo;
  onCleanup(async () => {
    proxy.closeAllConnections();
    await new Promise((resolve) => proxy.close(resolve));
  });
  return { origin: `http://127.0.0.1:${port}`, endpoint: `http://127.0.0.1:${port}/uploads`, requests };
}

describe("trustProxy", () => {
  test("is off by default: forwarded headers are ignored", async () => {
    const { endpoint } = await startServer();

    expect(await locationFor(endpoint, FORWARDED)).toBe(`${endpoint}/<id>`);
  });

  test("false ignores forwarded headers too", async () => {
    const { endpoint } = await startServer({ trustProxy: false });

    expect(await locationFor(endpoint, FORWARDED)).toBe(`${endpoint}/<id>`);
    expect(await locationFor(endpoint, { Forwarded: "proto=https;host=files.example.com" })).toBe(
      `${endpoint}/<id>`,
    );
  });

  test("true: upload URLs use the protocol and host the proxy reports", async () => {
    const { endpoint } = await startServer({ trustProxy: true });

    expect(await locationFor(endpoint, FORWARDED)).toBe("https://files.example.com/uploads/<id>");
  });

  test("true: the standard Forwarded header works as well", async () => {
    const { endpoint } = await startServer({ trustProxy: true });

    expect(await locationFor(endpoint, { Forwarded: "proto=https;host=files.example.com" })).toBe(
      "https://files.example.com/uploads/<id>",
    );
  });

  test("true: without forwarded headers the request's own host is used", async () => {
    const { endpoint } = await startServer({ trustProxy: true });

    expect(await locationFor(endpoint, {})).toBe(`${endpoint}/<id>`);
  });

  test("true: a protocol other than http or https is rejected with 400", async () => {
    const { endpoint } = await startServer({ trustProxy: true });

    const response = await create(endpoint, {
      headers: { "X-Forwarded-Proto": "javascript", "X-Forwarded-Host": "files.example.com" },
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
  });

  test("a whole upload through a reverse proxy stays on the proxy's address", async () => {
    const server = await startServer({ trustProxy: true });
    const proxy = await startReverseProxy(server.port);
    const data = randomBytes(300 * 1024);

    const url = await upload(proxy.endpoint, data, { chunkSize: 100 * 1024 });

    // The upload URL points at the proxy, not at the server behind it...
    expect(url.startsWith(`${proxy.endpoint}/`)).toBe(true);
    // ...so every request went through the proxy: the creation and the three chunks.
    expect(proxy.requests.filter((line) => line.startsWith("PATCH "))).toHaveLength(3);
    expect(proxy.requests[0]).toBe("POST /uploads");
    const stored = await readFile(join(server.directory, url.split("/").pop() as string));
    expect(stored.equals(data)).toBe(true);
  });

  test("without trustProxy, the same proxy gets an upload URL that bypasses it", async () => {
    const server = await startServer();
    const proxy = await startReverseProxy(server.port);

    const location = (await create(proxy.endpoint)).headers.get("location") as string;

    // This is the problem trustProxy solves: the URL names the server behind the proxy.
    expect(location.startsWith(`${server.endpoint}/`)).toBe(true);
  });
});
