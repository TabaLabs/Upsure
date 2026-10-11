import { type DetailedError, Upload } from "tus-js-client";
import type {
  FileState,
  RejectedFile,
  Uploader,
  UploaderOptions,
  UploaderState,
} from "./types";
import { validateFile } from "./validation";

export type {
  AddFilesResult,
  FileState,
  FileStatus,
  RejectedFile,
  RejectionReason,
  Uploader,
  UploaderOptions,
  UploaderState,
} from "./types";

const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;
const DEFAULT_PARALLEL_UPLOADS = 3;
const DEFAULT_RETRY_DELAYS = [0, 1000, 3000, 5000, 10000, 20000];

let nextId = 0;

function createId(): string {
  nextId += 1;
  return `upsure-${nextId}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Short, readable description of a failed upload, and whether trying again can help. */
function describeError(error: Error | DetailedError): { message: string; retryable: boolean } {
  const response = "originalResponse" in error ? error.originalResponse : undefined;
  if (response) {
    const body = response.getBody()?.trim();
    return {
      message: body || `Upload failed with status ${response.getStatus()}`,
      retryable: false,
    };
  }
  // A request went out but no response came back: the network is the problem.
  if ("originalRequest" in error && error.originalRequest) {
    return { message: "Network error: the server could not be reached", retryable: true };
  }
  return { message: error.message, retryable: false };
}

export function createUploader(options: UploaderOptions): Uploader {
  if (!options?.endpoint) {
    throw new Error("Upsure: the `endpoint` option is required.");
  }
  const parallelUploads = options.parallelUploads ?? DEFAULT_PARALLEL_UPLOADS;

  let state: UploaderState = { files: [] };
  /** The original File of every file in the state, by id. */
  const sources = new Map<string, File>();
  const listeners = new Set<() => void>();
  /** Queued files that were asked to start and wait for a free slot. */
  const waiting = new Set<string>();
  /** The running tus upload of every file that is uploading, by id. */
  const running = new Map<string, Upload>();

  /** Replaces the state with a new object and tells the listeners. */
  function setFiles(files: FileState[]): void {
    state = { files };
    for (const listener of [...listeners]) listener();
  }

  /** Applies a change to one file. Returns the new file state. */
  function updateFile(id: string, patch: Partial<FileState>): FileState | undefined {
    let updated: FileState | undefined;
    const files = state.files.map((file) => {
      if (file.id !== id) return file;
      updated = { ...file, ...patch };
      return updated;
    });
    if (updated) setFiles(files);
    return updated;
  }

  function buildMetadata(file: File): Record<string, string> {
    const custom =
      typeof options.metadata === "function" ? options.metadata(file) : options.metadata;
    const metadata: Record<string, string> = { ...custom, filename: file.name };
    // Browsers report no type for unknown extensions. Leave it out then, so
    // the server can fall back to the file name.
    if (file.type) metadata.filetype = file.type;
    else delete metadata.filetype;
    return metadata;
  }

  function begin(id: string, file: File): void {
    const { headers } = options;
    /** False once this upload has ended or the file was removed. */
    const isCurrent = () => running.get(id) === upload;

    const finish = (patch: Partial<FileState>): FileState | undefined => {
      running.delete(id);
      const updated = updateFile(id, patch);
      startNext();
      return updated;
    };

    const fail = (error: Error | DetailedError): void => {
      const { message, retryable } = describeError(error);
      const updated = finish({ status: "error", error: message, retryable });
      if (updated) options.onError?.(updated, error);
    };

    const upload = new Upload(file, {
      endpoint: options.endpoint,
      chunkSize: options.chunkSize ?? DEFAULT_CHUNK_SIZE,
      retryDelays: options.retryDelays ?? DEFAULT_RETRY_DELAYS,
      metadata: buildMetadata(file),
      headers: typeof headers === "function" ? {} : (headers ?? {}),
      storeFingerprintForResuming: false,
      async onBeforeRequest(request) {
        if (typeof headers !== "function") return;
        for (const [name, value] of Object.entries(await headers())) {
          request.setHeader(name, value);
        }
      },
      onProgress(bytesUploaded, bytesTotal) {
        if (!isCurrent()) return;
        updateFile(id, {
          bytesUploaded,
          progress: bytesTotal > 0 ? bytesUploaded / bytesTotal : 0,
        });
      },
      onSuccess() {
        if (!isCurrent()) return;
        const updated = finish({
          status: "complete",
          progress: 1,
          bytesUploaded: file.size,
          url: upload.url ?? undefined,
        });
        if (updated) options.onComplete?.(updated);
      },
      onError(error) {
        if (isCurrent()) fail(error);
      },
    });

    running.set(id, upload);
    updateFile(id, { status: "uploading" });
    try {
      upload.start();
    } catch (error) {
      if (isCurrent()) fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Starts waiting files, in the order they were added, while there are free slots. */
  function startNext(): void {
    for (const { id } of state.files) {
      if (running.size >= parallelUploads) return;
      const file = sources.get(id);
      if (file && waiting.delete(id)) begin(id, file);
    }
  }

  /** Stops the upload of a file, if any, without telling the server. */
  function stop(id: string): void {
    waiting.delete(id);
    const upload = running.get(id);
    if (!upload) return;
    running.delete(id);
    upload.abort().catch(() => {});
  }

  function stopAll(): void {
    for (const id of [...sources.keys()]) stop(id);
    sources.clear();
  }

  return {
    addFiles(files) {
      const accepted: FileState[] = [];
      const rejected: RejectedFile[] = [];

      for (const file of Array.from(files)) {
        const reason = validateFile(file, options, state.files.length + accepted.length);
        if (reason) {
          rejected.push({ file, reason });
          continue;
        }
        const id = createId();
        sources.set(id, file);
        accepted.push({
          id,
          name: file.name,
          size: file.size,
          type: file.type,
          status: "queued",
          progress: 0,
          bytesUploaded: 0,
        });
      }

      if (accepted.length > 0) {
        setFiles([...state.files, ...accepted]);
        if (options.autoStart ?? true) {
          for (const { id } of accepted) waiting.add(id);
          startNext();
        }
      }
      return { accepted, rejected };
    },

    start(id) {
      for (const file of state.files) {
        if (file.status === "queued" && (id === undefined || file.id === id)) {
          waiting.add(file.id);
        }
      }
      startNext();
    },

    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    remove(id) {
      if (!sources.has(id)) return;
      stop(id);
      sources.delete(id);
      setFiles(state.files.filter((file) => file.id !== id));
      startNext();
    },

    clear() {
      if (state.files.length === 0) return;
      stopAll();
      setFiles([]);
    },

    destroy() {
      listeners.clear();
      stopAll();
      state = { files: [] };
    },
  };
}
