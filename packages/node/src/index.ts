import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { FileStore } from "@tus/file-store";
import { Server } from "@tus/server";
import { isTypeAllowed } from "./allowed-types";
import { contentMatchesDeclaredType } from "./content-check";
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
   * How long an unfinished upload is kept, in milliseconds, before it is
   * deleted. Defaults to 24 hours. Set to `0` to keep unfinished uploads forever.
   */
  expireAfter?: number;
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
  /** Stops the cleanup of expired uploads. Call it when shutting down. */
  close(): Promise<void>;
  /** The underlying tus server, for anything Upsure doesn't cover. */
  tus: Server;
}

const HOUR = 60 * 60 * 1000;

export function createUpsureServer(options: UpsureServerOptions): UpsureServer {
  const { directory, allowedTypes, authorize, onUploadComplete } = options;
  const expireAfter = options.expireAfter ?? 24 * HOUR;

  const store = new FileStore({ directory, expirationPeriodInMilliseconds: expireAfter });

  const tus = new Server({
    path: options.path,
    datastore: store,
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
      const metadata = upload.metadata ?? {};
      const path = resolve(directory, upload.id);

      if (!(await contentMatchesDeclaredType(path, metadata.filetype, metadata.filename))) {
        await store.remove(upload.id);
        throw { status_code: 415, body: "File content does not match its declared type\n" };
      }

      if (onUploadComplete) {
        await onUploadComplete({
          id: upload.id,
          name: sanitizeFileName(metadata.filename, upload.id),
          type: metadata.filetype || "application/octet-stream",
          size: upload.size ?? upload.offset,
          path,
          metadata,
        });
      }
      return {};
    },
  });

  // FileStore's own `deleteExpired()` compares against the offset saved at
  // creation (always 0), so it would delete finished uploads too. This sweep
  // reads the real offset from disk and only removes incomplete ones.
  async function removeExpired(): Promise<void> {
    const now = Date.now();
    for (const id of (await store.configstore.list?.()) ?? []) {
      try {
        const upload = await store.getUpload(id);
        if (upload.offset === upload.size || !upload.creation_date) continue;
        if (now > new Date(upload.creation_date).getTime() + expireAfter) {
          await store.remove(id);
        }
      } catch {
        // Already gone or unreadable right now. The next sweep tries again.
      }
    }
  }

  // The timer is unref()'d so it never keeps the process alive.
  let cleanup: Promise<void> = Promise.resolve();
  let timer: NodeJS.Timeout | undefined;
  if (expireAfter > 0) {
    timer = setInterval(
      () => {
        cleanup = cleanup.then(removeExpired).catch(() => {});
      },
      Math.min(expireAfter, HOUR),
    );
    timer.unref();
  }

  return {
    handle: (req, res) => tus.handle(req, res),
    async close() {
      clearInterval(timer);
      await cleanup;
    },
    tus,
  };
}
