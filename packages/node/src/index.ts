import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { FileStore } from "@tus/file-store";
import { Server } from "@tus/server";
import { isTypeAllowed } from "./allowed-types";
import { sanitizeFileName } from "./sanitize";

/** A finished upload, as passed to `onUploadComplete`. */
export interface CompletedUpload {
  /** Upload id. Also the name of the stored file inside `directory`. */
  id: string;
  /** Original file name from the client, sanitized. Falls back to the id. */
  name: string;
  /** MIME type declared by the client. */
  type: string;
  /** Size in bytes. */
  size: number;
  /** Absolute path of the stored file. */
  path: string;
  /** All metadata the client sent with the upload. */
  metadata: Record<string, string | null>;
}

export interface UpsureServerOptions {
  /** URL path the upload endpoint is served from, e.g. `"/uploads"`. */
  path: string;
  /** Folder the uploaded files are written to. Created if it doesn't exist. */
  directory: string;
  /** Largest accepted file in bytes. Bigger uploads are rejected with 413. */
  maxFileSize?: number;
  /**
   * Accepted file types: MIME types (`"application/pdf"`), MIME wildcards
   * (`"image/*"`) or extensions (`".zip"`). Checked against the `filetype` and
   * `filename` upload metadata. Anything else is rejected with 415.
   */
  allowedTypes?: string[];
  /**
   * Called for every upload request (not CORS preflights). Return `false` to
   * reject the request with 401.
   */
  authorize?: (request: Request) => boolean | Promise<boolean>;
  /** Called once when an upload has been fully received. */
  onUploadComplete?: (file: CompletedUpload) => void | Promise<void>;
}

export interface UpsureServer {
  /** Request handler for plain `http` servers and Express routes. */
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  /** The underlying tus server, for anything Upsure doesn't cover. */
  tus: Server;
}

export function createUpsureServer(options: UpsureServerOptions): UpsureServer {
  const { directory, allowedTypes, authorize, onUploadComplete } = options;

  const tus = new Server({
    path: options.path,
    datastore: new FileStore({ directory }),
    maxSize: options.maxFileSize,

    async onIncomingRequest(request) {
      if (authorize && (await authorize(request)) === false) {
        throw { status_code: 401, body: "Unauthorized\n" };
      }
    },

    async onUploadCreate(_request, upload) {
      if (allowedTypes) {
        const type = upload.metadata?.filetype ?? undefined;
        const name = upload.metadata?.filename ?? undefined;
        if (!isTypeAllowed(allowedTypes, type, name)) {
          throw { status_code: 415, body: "File type not allowed\n" };
        }
      }
      return {};
    },

    async onUploadFinish(_request, upload) {
      if (onUploadComplete) {
        const metadata = upload.metadata ?? {};
        await onUploadComplete({
          id: upload.id,
          name: sanitizeFileName(metadata.filename, upload.id),
          type: metadata.filetype || "application/octet-stream",
          size: upload.size ?? upload.offset,
          path: resolve(directory, upload.id),
          metadata,
        });
      }
      return {};
    },
  });

  return {
    handle: (req, res) => tus.handle(req, res),
    tus,
  };
}
