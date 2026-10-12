import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUpsureServer, type UpsureServerOptions } from "@tabalabs/upsure-node";
import { afterEach } from "vitest";

/** One request the server has finished answering. */
export interface ServedRequest {
  method: string;
  /** Request path, e.g. `/uploads/<id>`. */
  path: string;
  /** The `Upload-Offset` request header, when sent. */
  offset?: number;
  status: number;
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** Starts a real Upsure server on a free port. It is torn down after the test. */
export async function startServer(options: Partial<UpsureServerOptions> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "upsure-core-"));
  const upsure = createUpsureServer({ ...options, path: "/uploads", directory });
  const requests: ServedRequest[] = [];
  const watchers = new Set<() => void>();

  const server = createServer((req, res) => {
    const offset = req.headers["upload-offset"];
    // "close" also fires when the client cuts the request short, e.g. on pause.
    res.on("close", () => {
      requests.push({
        method: req.method ?? "",
        path: req.url ?? "",
        offset: offset === undefined ? undefined : Number(offset),
        status: res.statusCode,
      });
      for (const watcher of [...watchers]) watcher();
    });
    upsure.handle(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const endpoint = `http://127.0.0.1:${port}/uploads`;

  let stopped: Promise<void> | undefined;
  const stop = () => {
    stopped ??= (async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await upsure.close();
    })();
    return stopped;
  };
  cleanups.push(async () => {
    await stop();
    await rm(directory, { recursive: true, force: true });
  });

  return {
    endpoint,
    directory,
    /** Every request the server has finished answering, in order. */
    requests,
    /** Shuts the server down. Also done automatically after the test. */
    stop,
    /** Resolves with the first finished request that matches, now or later. */
    waitForRequest(matches: (request: ServedRequest) => boolean): Promise<ServedRequest> {
      return new Promise((resolve) => {
        const check = () => {
          const found = requests.find(matches);
          if (!found) return;
          watchers.delete(check);
          resolve(found);
        };
        watchers.add(check);
        check();
      });
    },
    /** Asks the server for the status and saved offset of an upload. */
    async head(url: string): Promise<{ status: number; offset: number }> {
      const response = await fetch(url, { method: "HEAD", headers: { "Tus-Resumable": "1.0.0" } });
      return { status: response.status, offset: Number(response.headers.get("upload-offset")) };
    },
    /** Reads the stored bytes of an upload. */
    stored(url: string): Promise<Buffer> {
      return readFile(join(directory, url.split("/").pop() as string));
    },
  };
}
