export interface UploaderOptions {
  /** URL of the tus upload endpoint, e.g. `"/uploads"`. */
  endpoint: string;
  /** Largest accepted file in bytes. */
  maxFileSize?: number;
  /**
   * Accepted file types: MIME types (`"application/pdf"`), MIME wildcards
   * (`"image/*"`) or extensions (`".zip"`). A file passes if it matches any of them.
   */
  allowedTypes?: string[];
  /** Most files the uploader holds at once. */
  maxFiles?: number;
  /** Size of each upload request in bytes. Defaults to 5 MB. */
  chunkSize?: number;
  /** How many files upload at the same time. Defaults to 3. */
  parallelUploads?: number;
  /** Start uploading files as soon as they are added. Defaults to `true`. */
  autoStart?: boolean;
  /**
   * Delays in milliseconds between automatic retries of a failed request.
   * Defaults to `[0, 1000, 3000, 5000, 10000, 20000]`.
   */
  retryDelays?: number[];
  /**
   * Extra headers for every upload request, e.g. an auth token. A function is
   * called before each request, so it can return a fresh token.
   */
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  /**
   * Extra metadata sent with each upload. `filename` and `filetype` are
   * always sent and can't be overridden.
   */
  metadata?: Record<string, string> | ((file: File) => Record<string, string>);
  /**
   * Remember unfinished uploads in `localStorage`, so adding the same file
   * again after a page reload continues from where it stopped. Defaults to `true`.
   */
  resumeAfterReload?: boolean;
  /** Give image files a `previewUrl`. Defaults to `true`. */
  previews?: boolean;
  /** Called when a file has been fully uploaded. */
  onComplete?: (file: FileState) => void;
  /**
   * Called every time a file's status becomes `"error"`: at once when the
   * server rejects the upload or the browser is offline, otherwise after the
   * retries in `retryDelays` have run out. It is called again if a later
   * retry of the same file fails too.
   */
  onError?: (file: FileState, error: Error) => void;
}

export type FileStatus = "queued" | "uploading" | "paused" | "complete" | "error";

export interface FileState {
  /** Unique id, used to refer to the file in every other method. */
  id: string;
  name: string;
  /** Size in bytes. */
  size: number;
  /** MIME type as reported by the browser. Can be empty. */
  type: string;
  status: FileStatus;
  /** Upload progress from 0 to 1. */
  progress: number;
  bytesUploaded: number;
  /** Object URL of an image file, for use as an `<img>` source. */
  previewUrl?: string;
  /** URL of the upload on the server. Set once the upload is complete. */
  url?: string;
  /** Why the upload failed. Set when `status` is `"error"`. */
  error?: string;
  /**
   * Set when `status` is `"error"`: `true` when the server never answered (a
   * network problem), `false` when the server answered with an error. A file
   * with `retryable: true` is retried by itself when the browser comes back online.
   */
  retryable?: boolean;
}

export interface UploaderState {
  files: FileState[];
}

/**
 * Why a file was not accepted: `"empty"` (zero bytes), `"type"` (not in
 * `allowedTypes`), `"size"` (over `maxFileSize`) or `"too-many-files"` (over `maxFiles`).
 */
export type RejectionReason = "type" | "size" | "too-many-files" | "empty";

export interface RejectedFile {
  file: File;
  reason: RejectionReason;
}

export interface AddFilesResult {
  accepted: FileState[];
  rejected: RejectedFile[];
}

export interface Uploader {
  /** Validates the files and queues the ones that pass. */
  addFiles(files: FileList | File[]): AddFilesResult;
  /**
   * Starts uploading one queued file, or all queued files when no id is given.
   * Files wait their turn when `parallelUploads` are already running.
   */
  start(id?: string): void;
  /** Pauses a file that is uploading or queued. Its progress is kept. */
  pause(id: string): void;
  /** Continues a paused file from where it stopped. */
  resume(id: string): void;
  /** Tries a failed file again, continuing from what the server already has. */
  retry(id: string): void;
  /**
   * Stops the upload, deletes what was already uploaded from the server and
   * removes the file. A finished upload is not deleted from the server.
   */
  cancel(id: string): void;
  /** Current state. The same object is returned until something changes. */
  getState(): UploaderState;
  /** Calls `listener` after every state change. Returns a function that unsubscribes. */
  subscribe(listener: () => void): () => void;
  /** Removes one file. An upload in progress is stopped, but stays on the server. */
  remove(id: string): void;
  /** Removes all files. Uploads in progress are stopped. */
  clear(): void;
  /** Removes all files and all listeners. Uploads in progress are stopped. */
  destroy(): void;
}
