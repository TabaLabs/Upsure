/**
 * Every text the `<Upsure />` component shows or announces. Pass any of them
 * in the `labels` prop to reword or translate the component.
 */
export interface UpsureLabels {
  /** Text of the dropzone button. */
  dropzone: string;
  /** Text of the dropzone button while files are dragged over it. */
  dropzoneDragging: string;
  /** Accessible name of the file list. */
  fileList: string;
  /** Accessible name of the list of rejection messages. */
  rejectionList: string;

  statusQueued: string;
  statusUploading: string;
  statusPaused: string;
  statusComplete: string;
  statusError: string;

  /** Visible button texts. */
  pause: string;
  resume: string;
  cancel: string;
  retry: string;
  remove: string;
  dismiss: string;

  /** Accessible button names. They must include the file name. */
  pauseFile: (name: string) => string;
  resumeFile: (name: string) => string;
  cancelFile: (name: string) => string;
  retryFile: (name: string) => string;
  removeFile: (name: string) => string;
  dismissFile: (name: string) => string;
  /** Accessible name of a file's progress bar. */
  progressOf: (name: string) => string;

  /** Why a file was rejected. Shown after the file name, as in "photo.exe: this file type isn't allowed". */
  rejectedType: string;
  /** `maxSize` is already formatted, e.g. "50 MB". */
  rejectedSize: (maxSize: string) => string;
  rejectedTooManyFiles: (maxFiles: number) => string;
  rejectedEmpty: string;

  /** Announced to screen readers. */
  announceComplete: (name: string) => string;
  announceError: (name: string, error: string) => string;
}

export const defaultLabels: UpsureLabels = {
  dropzone: "Drag files here or click to choose",
  dropzoneDragging: "Drop the files to upload them",
  fileList: "Files",
  rejectionList: "Files that could not be added",

  statusQueued: "Waiting",
  statusUploading: "Uploading",
  statusPaused: "Paused",
  statusComplete: "Uploaded",
  statusError: "Failed",

  pause: "Pause",
  resume: "Resume",
  cancel: "Cancel",
  retry: "Retry",
  remove: "Remove",
  dismiss: "Dismiss",

  pauseFile: (name) => `Pause ${name}`,
  resumeFile: (name) => `Resume ${name}`,
  cancelFile: (name) => `Cancel ${name}`,
  retryFile: (name) => `Retry ${name}`,
  removeFile: (name) => `Remove ${name}`,
  dismissFile: (name) => `Dismiss the message about ${name}`,
  progressOf: (name) => `Upload progress of ${name}`,

  rejectedType: "this file type isn't allowed",
  rejectedSize: (maxSize) => `larger than ${maxSize}`,
  rejectedTooManyFiles: (maxFiles) =>
    maxFiles === 1 ? "only 1 file is allowed" : `only ${maxFiles} files are allowed`,
  rejectedEmpty: "the file is empty",

  announceComplete: (name) => `${name} uploaded`,
  announceError: (name, error) => `${name} failed: ${error}`,
};
