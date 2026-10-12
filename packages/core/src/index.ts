import { type DetailedError, type PreviousUpload, Upload } from "tus-js-client";
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

/** What the uploader keeps for every file in the state. */
interface Entry {
  file: File;
  /** The tus upload. Created on the first start and reused, so it resumes instead of restarting. */
  upload?: Upload;
  /** Settles when the upload may be started: after the lookup of a previous upload, or a pause. */
  ready?: Promise<unknown>;
}

/** The most recently created of the stored uploads of a file. */
function latest(previous: PreviousUpload[]): PreviousUpload | undefined {
  return [...previous].sort(
    (a, b) => new Date(b.creationTime).getTime() - new Date(a.creationTime).getTime(),
  )[0];
}

/** A copy of the file state without the fields that describe a failure. */
function withoutError({ error, retryable, ...file }: FileState): FileState {
  return file;
}

export function createUploader(options: UploaderOptions): Uploader {
  if (!options?.endpoint) {
    throw new Error("Upsure: the `endpoint` option is required.");
  }
  const parallelUploads = options.parallelUploads ?? DEFAULT_PARALLEL_UPLOADS;
  const resumeAfterReload = options.resumeAfterReload ?? true;
  const previews =
    (options.previews ?? true) &&
    typeof URL !== "undefined" &&
    typeof URL.createObjectURL === "function";

  let state: UploaderState = { files: [] };
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  /** Queued files that were asked to start and wait for a free slot. */
  const waiting = new Set<string>();
  /** Files that are uploading right now. */
  const running = new Set<string>();

  /** Replaces the state with a new object and tells the listeners. */
  function setFiles(files: FileState[]): void {
    state = { files };
    for (const listener of [...listeners]) listener();
  }

  const getFile = (id: string) => state.files.find((file) => file.id === id);

  /** Applies a change to one file. Returns the new file state. */
  function updateFile(
    id: string,
    change: Partial<FileState> | ((file: FileState) => FileState),
  ): FileState | undefined {
    let updated: FileState | undefined;
    const files = state.files.map((file) => {
      if (file.id !== id) return file;
      updated = typeof change === "function" ? change(file) : { ...file, ...change };
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

  function createUpload(id: string, entry: Entry): Upload {
    const { file } = entry;
    const { headers } = options;
    /** False while the file is paused, and once it has ended or was removed. */
    const isCurrent = () => running.has(id) && entries.get(id) === entry;

    const finish = (patch: Partial<FileState>): FileState | undefined => {
      running.delete(id);
      const updated = updateFile(id, patch);
      startNext();
      return updated;
    };

    const upload = new Upload(file, {
      endpoint: options.endpoint,
      chunkSize: options.chunkSize ?? DEFAULT_CHUNK_SIZE,
      retryDelays: options.retryDelays ?? DEFAULT_RETRY_DELAYS,
      metadata: buildMetadata(file),
      headers: typeof headers === "function" ? {} : (headers ?? {}),
      storeFingerprintForResuming: resumeAfterReload,
      removeFingerprintOnSuccess: true,
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
        if (!isCurrent()) return;
        const { message, retryable } = describeError(error);
        const updated = finish({ status: "error", error: message, retryable });
        if (updated) options.onError?.(updated, error);
      },
    });

    if (resumeAfterReload) {
      // If this file was being uploaded before a page reload, continue that upload.
      entry.ready = upload
        .findPreviousUploads()
        .then((previous) => {
          const match = latest(previous);
          if (match) upload.resumeFromPreviousUpload(match);
        })
        .catch(() => {});
    }
    return upload;
  }

  /**
   * Starts or continues the upload of a file. The tus upload is reused, so a
   * paused or failed file continues from the offset the server has.
   */
  function begin(id: string, entry: Entry): void {
    running.add(id);
    updateFile(id, (file) => ({ ...withoutError(file), status: "uploading" }));

    entry.upload ??= createUpload(id, entry);
    const { upload } = entry;
    const launch = () => {
      // Paused or removed while waiting.
      if (!running.has(id) || entries.get(id) !== entry) return;
      try {
        upload.start();
      } catch (error) {
        upload.options.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    };
    if (entry.ready) entry.ready.then(launch);
    else launch();
  }

  /** Starts waiting files, in the order they were added, while there are free slots. */
  function startNext(): void {
    for (const { id } of state.files) {
      if (running.size >= parallelUploads) return;
      const entry = entries.get(id);
      if (entry && waiting.delete(id)) begin(id, entry);
    }
  }

  /** Puts paused or failed files back in line for a free slot. */
  function enqueue(ids: string[]): void {
    for (const id of ids) {
      waiting.add(id);
      updateFile(id, (file) => ({ ...withoutError(file), status: "queued" }));
    }
    startNext();
  }

  /**
   * Stops the upload of a file and forgets the file. With `terminate`, an
   * unfinished upload is also deleted from the server.
   */
  function discard(id: string, terminate = false): void {
    const entry = entries.get(id);
    if (!entry) return;
    const file = getFile(id);
    waiting.delete(id);
    running.delete(id);
    entries.delete(id);
    entry.upload?.abort(terminate && file?.status !== "complete").catch(() => {});
    if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl);
  }

  /** Retries the files that failed because the network was down. */
  function retryAfterReconnect(): void {
    enqueue(
      state.files.filter((file) => file.status === "error" && file.retryable).map(({ id }) => id),
    );
  }

  const hasWindow = typeof window !== "undefined";
  if (hasWindow) window.addEventListener("online", retryAfterReconnect);

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
        entries.set(id, { file });
        const fileState: FileState = {
          id,
          name: file.name,
          size: file.size,
          type: file.type,
          status: "queued",
          progress: 0,
          bytesUploaded: 0,
        };
        if (previews && file.type.startsWith("image/")) {
          fileState.previewUrl = URL.createObjectURL(file);
        }
        accepted.push(fileState);
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

    pause(id) {
      const status = getFile(id)?.status;
      if (status !== "uploading" && status !== "queued") return;
      waiting.delete(id);
      running.delete(id);
      const entry = entries.get(id);
      if (entry?.upload) {
        // A later resume waits until the running request has really stopped.
        entry.ready = Promise.all([entry.ready, entry.upload.abort().catch(() => {})]);
      }
      updateFile(id, { status: "paused" });
      startNext();
    },

    resume(id) {
      if (getFile(id)?.status === "paused") enqueue([id]);
    },

    retry(id) {
      if (getFile(id)?.status === "error") enqueue([id]);
    },

    cancel(id) {
      if (!entries.has(id)) return;
      discard(id, true);
      setFiles(state.files.filter((file) => file.id !== id));
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
      if (!entries.has(id)) return;
      discard(id);
      setFiles(state.files.filter((file) => file.id !== id));
      startNext();
    },

    clear() {
      if (state.files.length === 0) return;
      for (const id of [...entries.keys()]) discard(id);
      setFiles([]);
    },

    destroy() {
      if (hasWindow) window.removeEventListener("online", retryAfterReconnect);
      listeners.clear();
      for (const id of [...entries.keys()]) discard(id);
      state = { files: [] };
    },
  };
}
