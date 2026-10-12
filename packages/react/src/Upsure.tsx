import type { FileState, RejectedFile } from "@tabalabs/upsure";
import {
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { formatSize } from "./format";
import { defaultLabels, type UpsureLabels } from "./labels";
import { type UseUpsureOptions, useUpsure } from "./useUpsure";

export interface UpsureProps extends UseUpsureOptions {
  /** Extra class name for the root element. */
  className?: string;
  /** Stops new files from being added. Files already in the list keep working. */
  disabled?: boolean;
  /** Allow choosing several files at once. Defaults to `true`. */
  multiple?: boolean;
  /** Replaces any of the component's texts, e.g. to translate them. */
  labels?: Partial<UpsureLabels>;
}

interface Rejection {
  key: number;
  name: string;
  message: string;
}

/** Keeps the live region out of sight without any stylesheet, but readable by screen readers. */
const visuallyHidden: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

let nextRejectionKey = 0;

/**
 * Drop-in uploader: a dropzone, a file list with progress and controls, and
 * messages for rejected files. Works unstyled; import
 * `@tabalabs/upsure-react/styles.css` for the default look.
 */
export function Upsure({
  className,
  disabled = false,
  multiple = true,
  labels: customLabels,
  ...options
}: UpsureProps) {
  const labels = useMemo(() => ({ ...defaultLabels, ...customLabels }), [customLabels]);
  const { files, addFiles, pause, resume, cancel, retry, remove } = useUpsure(options);

  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  /** dragenter and dragleave also fire for child elements; only the outermost pair counts. */
  const dragDepth = useRef(0);
  const [rejections, setRejections] = useState<Rejection[]>([]);
  const [announcement, setAnnouncement] = useState("");

  function describeRejection({ file, reason }: RejectedFile): Rejection {
    const reasons = {
      type: labels.rejectedType,
      size: labels.rejectedSize(formatSize(options.maxFileSize ?? 0)),
      "too-many-files": labels.rejectedTooManyFiles(options.maxFiles ?? 0),
      empty: labels.rejectedEmpty,
    };
    nextRejectionKey += 1;
    return { key: nextRejectionKey, name: file.name, message: `${file.name}: ${reasons[reason]}` };
  }

  function add(list: FileList | File[]): void {
    const chosen = Array.from(list);
    const { rejected } = addFiles(multiple ? chosen : chosen.slice(0, 1));
    const next = rejected.map(describeRejection);
    setRejections(next);
    if (next.length > 0) setAnnouncement(next.map((rejection) => rejection.message).join(". "));
  }

  // Announce uploads that finished or failed since the last render.
  const previousStatuses = useRef(new Map<string, FileState["status"]>());
  useEffect(() => {
    const messages: string[] = [];
    for (const file of files) {
      if (previousStatuses.current.get(file.id) === file.status) continue;
      if (file.status === "complete") messages.push(labels.announceComplete(file.name));
      if (file.status === "error") messages.push(labels.announceError(file.name, file.error ?? ""));
    }
    previousStatuses.current = new Map(files.map((file) => [file.id, file.status]));
    if (messages.length > 0) setAnnouncement(messages.join(". "));
  }, [files, labels]);

  function onInputChange(event: ChangeEvent<HTMLInputElement>): void {
    if (event.target.files) add(event.target.files);
    // Lets the same file be chosen again later.
    event.target.value = "";
  }

  function onDragEnter(event: DragEvent): void {
    if (disabled) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }

  function onDragOver(event: DragEvent): void {
    // Without this the browser doesn't allow a drop here.
    if (!disabled) event.preventDefault();
  }

  function onDragLeave(): void {
    dragDepth.current = Math.max(dragDepth.current - 1, 0);
    if (dragDepth.current === 0) setDragging(false);
  }

  function onDrop(event: DragEvent): void {
    // Always handled, so a file dropped on a disabled dropzone doesn't open in the tab.
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (!disabled && event.dataTransfer.files.length > 0) add(event.dataTransfer.files);
  }

  const statusLabels: Record<FileState["status"], string> = {
    queued: labels.statusQueued,
    uploading: labels.statusUploading,
    paused: labels.statusPaused,
    complete: labels.statusComplete,
    error: labels.statusError,
  };

  function statusText(file: FileState, percent: number): string {
    const text = statusLabels[file.status];
    if (file.status === "error" && file.error) return `${text}: ${file.error}`;
    if (file.status === "uploading" || file.status === "paused") return `${text} ${percent}%`;
    return text;
  }

  function fileButton(
    kind: "pause" | "resume" | "cancel" | "retry" | "remove",
    file: FileState,
    action: (id: string) => void,
  ) {
    return (
      <button
        type="button"
        className={`upsure-button upsure-${kind}`}
        aria-label={labels[`${kind}File`](file.name)}
        onClick={() => action(file.id)}
      >
        {labels[kind]}
      </button>
    );
  }

  return (
    <div
      className={className ? `upsure ${className}` : "upsure"}
      data-disabled={disabled || undefined}
    >
      {/* Only a drop target: the button inside is the control. */}
      <div
        className="upsure-dropzone"
        data-dragging={dragging}
        data-disabled={disabled || undefined}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <button
          type="button"
          className="upsure-dropzone-button"
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          {dragging ? labels.dropzoneDragging : labels.dropzone}
        </button>
        <input
          ref={input}
          className="upsure-input"
          type="file"
          hidden
          tabIndex={-1}
          multiple={multiple}
          accept={options.allowedTypes?.join(",")}
          disabled={disabled}
          onChange={onInputChange}
        />
      </div>

      {rejections.length > 0 && (
        <ul className="upsure-rejections" aria-label={labels.rejectionList}>
          {rejections.map((rejection) => (
            <li key={rejection.key} className="upsure-rejection">
              <span className="upsure-rejection-message">{rejection.message}</span>
              <button
                type="button"
                className="upsure-button upsure-dismiss"
                aria-label={labels.dismissFile(rejection.name)}
                onClick={() =>
                  setRejections((current) => current.filter((item) => item.key !== rejection.key))
                }
              >
                {labels.dismiss}
              </button>
            </li>
          ))}
        </ul>
      )}

      {files.length > 0 && (
        <ul className="upsure-files" aria-label={labels.fileList}>
          {files.map((file) => {
            const percent = Math.round(file.progress * 100);
            return (
              <li key={file.id} className="upsure-file" data-status={file.status}>
                {file.previewUrl && (
                  <img className="upsure-preview" src={file.previewUrl} alt="" />
                )}
                <div className="upsure-file-info">
                  <span className="upsure-file-name">{file.name}</span>{" "}
                  <span className="upsure-file-size">{formatSize(file.size)}</span>{" "}
                  <span className="upsure-file-status" data-status={file.status}>
                    {statusText(file, percent)}
                  </span>
                </div>
                <div
                  className="upsure-progress"
                  data-status={file.status}
                  role="progressbar"
                  aria-label={labels.progressOf(file.name)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                >
                  <div className="upsure-progress-bar" style={{ width: `${percent}%` }} />
                </div>
                <div className="upsure-actions">
                  {file.status === "uploading" && fileButton("pause", file, pause)}
                  {file.status === "paused" && fileButton("resume", file, resume)}
                  {file.status === "error" && fileButton("retry", file, retry)}
                  {(file.status === "uploading" || file.status === "paused") &&
                    fileButton("cancel", file, cancel)}
                  {(file.status === "queued" ||
                    file.status === "complete" ||
                    file.status === "error") &&
                    fileButton("remove", file, remove)}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="upsure-live" role="status" aria-live="polite" style={visuallyHidden}>
        {announcement}
      </div>
    </div>
  );
}
