import {
  type AddFilesResult,
  createUploader,
  type FileState,
  type RejectedFile,
  type Uploader,
  type UploaderOptions,
  type UploaderState,
} from "@tabalabs/upsure";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

export interface UseUpsureOptions extends UploaderOptions {
  /** Called with the files `addFiles` did not accept, and why. */
  onRejected?: (rejected: RejectedFile[]) => void;
}

export interface UseUpsureResult {
  /** Every file the uploader holds, in the order they were added. */
  files: FileState[];
  /** Validates the files and queues the ones that pass. */
  addFiles(files: FileList | File[]): AddFilesResult;
  /** Starts one queued file, or all queued files when no id is given. */
  start(id?: string): void;
  pause(id: string): void;
  resume(id: string): void;
  /** Stops the upload, deletes it from the server and removes the file. */
  cancel(id: string): void;
  /** Tries a failed file again. */
  retry(id: string): void;
  remove(id: string): void;
  clear(): void;
  /** Progress across all files, from 0 to 1, weighted by file size. */
  totalProgress: number;
  /** True while at least one file is uploading. */
  isUploading: boolean;
  /**
   * The uploader itself, for advanced use. It is `null` on the server and
   * during the very first render, before the component has mounted.
   */
  uploader: Uploader | null;
}

/** What the hook shows before the uploader exists: on the server and on the first render. */
const EMPTY_STATE: UploaderState = { files: [] };
const getEmptyState = () => EMPTY_STATE;
const subscribeToNothing = () => () => {};

/**
 * Resumable uploads for a React component. Options are read once, when the
 * component mounts; only the callbacks (`onComplete`, `onError`, `onRejected`)
 * follow later renders.
 */
export function useUpsure(options: UseUpsureOptions): UseUpsureResult {
  // Always points at the options of the latest render, so callbacks are never stale.
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  // The uploader is created in an effect, not during render: it listens for
  // the browser's "online" event, and a render can run on the server or be
  // thrown away. StrictMode runs the effect twice; the first uploader is
  // destroyed and the second one is used.
  const [uploader, setUploader] = useState<Uploader | null>(null);
  useEffect(() => {
    const created = createUploader({
      ...latest.current,
      onComplete: (file) => latest.current.onComplete?.(file),
      onError: (file, error) => latest.current.onError?.(file, error),
    });
    setUploader(created);
    return () => {
      created.destroy();
      setUploader(null);
    };
  }, []);

  const state = useSyncExternalStore(
    uploader ? uploader.subscribe : subscribeToNothing,
    uploader ? uploader.getState : getEmptyState,
    getEmptyState,
  );

  const actions = useMemo(
    () => ({
      addFiles(files: FileList | File[]): AddFilesResult {
        if (!uploader) return { accepted: [], rejected: [] };
        const result = uploader.addFiles(files);
        if (result.rejected.length > 0) latest.current.onRejected?.(result.rejected);
        return result;
      },
      start: (id?: string) => uploader?.start(id),
      pause: (id: string) => uploader?.pause(id),
      resume: (id: string) => uploader?.resume(id),
      cancel: (id: string) => uploader?.cancel(id),
      retry: (id: string) => uploader?.retry(id),
      remove: (id: string) => uploader?.remove(id),
      clear: () => uploader?.clear(),
    }),
    [uploader],
  );

  const { totalProgress, isUploading } = useMemo(() => {
    let size = 0;
    let uploaded = 0;
    for (const file of state.files) {
      size += file.size;
      uploaded += file.status === "complete" ? file.size : file.bytesUploaded;
    }
    return {
      totalProgress: size > 0 ? Math.min(uploaded / size, 1) : 0,
      isUploading: state.files.some((file) => file.status === "uploading"),
    };
  }, [state]);

  return { files: state.files, ...actions, totalProgress, isUploading, uploader };
}
