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

let nextId = 0;

function createId(): string {
  nextId += 1;
  return `upsure-${nextId}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createUploader(options: UploaderOptions): Uploader {
  if (!options?.endpoint) {
    throw new Error("Upsure: the `endpoint` option is required.");
  }

  let state: UploaderState = { files: [] };
  /** The original File of every file in the state, by id. */
  const sources = new Map<string, File>();
  const listeners = new Set<() => void>();

  /** Replaces the state with a new object and tells the listeners. */
  function setFiles(files: FileState[]): void {
    state = { files };
    for (const listener of [...listeners]) listener();
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

      if (accepted.length > 0) setFiles([...state.files, ...accepted]);
      return { accepted, rejected };
    },

    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    remove(id) {
      if (!sources.delete(id)) return;
      setFiles(state.files.filter((file) => file.id !== id));
    },

    clear() {
      if (state.files.length === 0) return;
      sources.clear();
      setFiles([]);
    },

    destroy() {
      listeners.clear();
      sources.clear();
      state = { files: [] };
    },
  };
}
