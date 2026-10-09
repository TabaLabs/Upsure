import type { IncomingMessage, ServerResponse } from "node:http";
import { FileStore } from "@tus/file-store";
import { Server } from "@tus/server";

export interface UpsureServerOptions {
  /** URL path the upload endpoint is served from, e.g. `"/uploads"`. */
  path: string;
  /** Folder the uploaded files are written to. Created if it doesn't exist. */
  directory: string;
}

export interface UpsureServer {
  /** Request handler for plain `http` servers and Express routes. */
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  /** The underlying tus server, for anything Upsure doesn't cover. */
  tus: Server;
}

export function createUpsureServer(options: UpsureServerOptions): UpsureServer {
  const tus = new Server({
    path: options.path,
    datastore: new FileStore({ directory: options.directory }),
  });

  return {
    handle: (req, res) => tus.handle(req, res),
    tus,
  };
}
