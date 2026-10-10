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
  /** Current state. The same object is returned until something changes. */
  getState(): UploaderState;
  /** Calls `listener` after every state change. Returns a function that unsubscribes. */
  subscribe(listener: () => void): () => void;
  /** Removes one file. */
  remove(id: string): void;
  /** Removes all files. */
  clear(): void;
  /** Removes all files and all listeners. */
  destroy(): void;
}
