import type { PreviousUpload, UploadOptions } from "tus-js-client";
import { vi } from "vitest";

/**
 * Stand-in for tus-js-client in unit tests. Use it with
 * `vi.mock("tus-js-client", () => import("./fake-tus"))` and drive the uploads
 * through their `options` callbacks.
 */
export const tus = {
  /** Every Upload created since the last reset, in order. */
  uploads: [] as Upload[],
  /** When set, `start()` throws it. */
  startError: null as Error | null,
  /** What `findPreviousUploads()` resolves with. */
  previous: [] as PreviousUpload[],
  /** When set, `findPreviousUploads()` rejects with it. */
  lookupError: null as Error | null,
};

export function resetTus(): void {
  tus.uploads.length = 0;
  tus.startError = null;
  tus.previous = [];
  tus.lookupError = null;
}

export class Upload {
  url: string | null = null;
  start = vi.fn(() => {
    if (tus.startError) throw tus.startError;
  });
  abort = vi.fn((_shouldTerminate?: boolean) => Promise.resolve());
  findPreviousUploads = vi.fn(() =>
    tus.lookupError ? Promise.reject(tus.lookupError) : Promise.resolve(tus.previous),
  );
  resumeFromPreviousUpload = vi.fn((previous: PreviousUpload) => {
    this.url = previous.uploadUrl;
  });

  constructor(
    public file: File,
    public options: UploadOptions,
  ) {
    tus.uploads.push(this);
  }
}

/** Lets pending promise callbacks run, e.g. the lookup of a previous upload before a start. */
export const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The fake tus upload created for a file name. */
export function uploadOf(name: string): Upload {
  const upload = tus.uploads.find((candidate) => candidate.file.name === name);
  if (!upload) throw new Error(`No upload was started for ${name}`);
  return upload;
}

export function succeed(name: string, url = `https://example.test/uploads/${name}`): void {
  const upload = uploadOf(name);
  upload.url = url;
  upload.options.onSuccess?.({ lastResponse: undefined as never });
}

/** A tus error for a request the server answered with `status`. */
export function serverError(status: number, body: string): Error {
  return Object.assign(new Error(`tus: unexpected response, response code: ${status}`), {
    originalRequest: {},
    originalResponse: { getStatus: () => status, getBody: () => body },
  });
}

/** A tus error for a request that never got a response. */
export function networkError(): Error {
  return Object.assign(new Error("tus: failed to upload chunk at offset 0"), {
    originalRequest: {},
    originalResponse: null,
  });
}

export function fail(name: string, error: Error): void {
  uploadOf(name).options.onError?.(error);
}
