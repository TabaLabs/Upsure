import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fail, networkError, resetTus, serverError, succeed, tus, uploadOf } from "../../core/test/fake-tus";
import { formatSize } from "../src/format";
import { Upsure, type UpsureProps } from "../src/index";

// tus-js-client is replaced by the core's fake for every test in this package
// (see vitest.config.ts), so nothing here touches the network.

const endpoint = "https://example.test/uploads";
const MB = 1024 * 1024;

/** A File with a faked size, so tests can use any size without allocating it. */
function makeFile(name: string, type = "text/plain", size = 1000): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function renderUpsure(props: Partial<UpsureProps> = {}) {
  const view = render(<Upsure endpoint={endpoint} {...props} />);
  const root = view.container.firstElementChild as HTMLElement;
  return {
    ...view,
    root,
    dropzone: root.querySelector(".upsure-dropzone") as HTMLElement,
    input: root.querySelector("input[type=file]") as HTMLInputElement,
    button: root.querySelector(".upsure-dropzone-button") as HTMLButtonElement,
    live: root.querySelector(".upsure-live") as HTMLElement,
  };
}

/** Drops files on the dropzone, the way a browser reports them. */
function drop(target: HTMLElement, files: File[]): void {
  fireEvent.drop(target, { dataTransfer: { files, types: ["Files"] } });
}

/** The list item of a file, by file name. */
function fileItem(name: string): HTMLElement {
  const item = screen.getByText(name, { selector: ".upsure-file-name" }).closest("li");
  if (!item) throw new Error(`No list item for ${name}`);
  return item;
}

/** A rejection message in the visible list (the live region repeats it for screen readers). */
const rejectionMessage = (text: string) =>
  screen.queryByText(text, { selector: ".upsure-rejection-message" });

const buttonNames = (item: HTMLElement) =>
  within(item)
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label"));

beforeEach(resetTus);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("adding files", () => {
  test("dropping files adds them to the list", () => {
    const { dropzone } = renderUpsure();

    drop(dropzone, [makeFile("a.txt"), makeFile("b.txt")]);

    const list = screen.getByRole("list", { name: "Files" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(fileItem("a.txt").dataset.status).toBe("uploading");
    expect(fileItem("b.txt").dataset.status).toBe("uploading");
  });

  test("choosing files with the input adds them to the list", async () => {
    const user = userEvent.setup();
    const { input } = renderUpsure();

    await user.upload(input, [makeFile("a.txt"), makeFile("b.txt")]);

    expect(fileItem("a.txt")).toBeTruthy();
    expect(fileItem("b.txt")).toBeTruthy();
    // Cleared, so the same file can be chosen again.
    expect(input.value).toBe("");
  });

  test("clicking the dropzone opens the file picker", async () => {
    const user = userEvent.setup();
    const { button, input } = renderUpsure();
    const open = vi.spyOn(input, "click");

    await user.click(button);

    expect(open).toHaveBeenCalledTimes(1);
  });

  test("the keyboard opens the file picker: Tab to focus, then Enter or Space", async () => {
    const user = userEvent.setup();
    const { button, input } = renderUpsure();
    const open = vi.spyOn(input, "click");

    await user.tab();
    expect(document.activeElement).toBe(button);

    await user.keyboard("{Enter}");
    expect(open).toHaveBeenCalledTimes(1);

    await user.keyboard(" ");
    expect(open).toHaveBeenCalledTimes(2);
  });

  test("the dropzone is a real button and the file input is not a tab stop", () => {
    const { button, input } = renderUpsure();

    expect(button.tagName).toBe("BUTTON");
    expect(button.type).toBe("button");
    expect(button.textContent).toBe("Drag files here or click to choose");
    expect(input.hidden).toBe(true);
    expect(input.tabIndex).toBe(-1);
  });

  test("shows a drag-over state while files are dragged over it", () => {
    const { dropzone, button } = renderUpsure();
    expect(dropzone.dataset.dragging).toBe("false");

    fireEvent.dragEnter(dropzone);
    // Moving onto the button inside must not end the state.
    fireEvent.dragEnter(button);
    fireEvent.dragLeave(dropzone);
    expect(dropzone.dataset.dragging).toBe("true");
    expect(button.textContent).toBe("Drop the files to upload them");

    fireEvent.dragLeave(button);
    expect(dropzone.dataset.dragging).toBe("false");
    expect(button.textContent).toBe("Drag files here or click to choose");
  });

  test("dropping ends the drag-over state", () => {
    const { dropzone } = renderUpsure();
    fireEvent.dragEnter(dropzone);

    drop(dropzone, [makeFile("a.txt")]);

    expect(dropzone.dataset.dragging).toBe("false");
  });

  test("dragover is accepted, so the browser allows the drop", () => {
    const { dropzone } = renderUpsure();

    // fireEvent returns false when preventDefault() was called.
    expect(fireEvent.dragOver(dropzone)).toBe(false);
  });

  test("multiple is on by default and can be turned off", () => {
    const { input, unmount } = renderUpsure();
    expect(input.multiple).toBe(true);
    unmount();

    const single = renderUpsure({ multiple: false });
    expect(single.input.multiple).toBe(false);

    drop(single.dropzone, [makeFile("a.txt"), makeFile("b.txt")]);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(fileItem("a.txt")).toBeTruthy();
  });

  test("disabled stops new files but keeps the list working", () => {
    const { dropzone, button, input, rerender } = renderUpsure();
    drop(dropzone, [makeFile("a.txt")]);

    rerender(<Upsure endpoint={endpoint} disabled />);
    drop(dropzone, [makeFile("b.txt")]);
    fireEvent.dragEnter(dropzone);

    expect(button.disabled).toBe(true);
    expect(input.disabled).toBe(true);
    expect(dropzone.dataset.dragging).toBe("false");
    expect(screen.queryByText("b.txt")).toBeNull();
    expect(buttonNames(fileItem("a.txt"))).toEqual(["Pause a.txt", "Cancel a.txt"]);
  });
});

describe("accept attribute", () => {
  test("matches allowedTypes", () => {
    const { input } = renderUpsure({ allowedTypes: ["image/*", "application/pdf", ".zip"] });

    expect(input.accept).toBe("image/*,application/pdf,.zip");
  });

  test("is left out when every type is allowed", () => {
    const { input } = renderUpsure();

    expect(input.hasAttribute("accept")).toBe(false);
  });
});

describe("file list", () => {
  test("shows name, size and status for each file", () => {
    const { dropzone } = renderUpsure();

    drop(dropzone, [makeFile("holiday.mov", "video/quicktime", Math.round(4.2 * MB))]);

    const item = fileItem("holiday.mov");
    expect(item.querySelector(".upsure-file-size")?.textContent).toBe("4.2 MB");
    expect(item.querySelector(".upsure-file-status")?.textContent).toBe("Uploading 0%");
  });

  test("formats sizes for people", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(999)).toBe("999 B");
    expect(formatSize(1024)).toBe("1 KB");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(Math.round(4.2 * MB))).toBe("4.2 MB");
    expect(formatSize(50 * MB)).toBe("50 MB");
    expect(formatSize(3 * 1024 * MB)).toBe("3 GB");
  });

  test("shows an image preview when the file has one", () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview-1");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const { dropzone } = renderUpsure();

    drop(dropzone, [makeFile("photo.png", "image/png"), makeFile("notes.txt")]);

    const preview = fileItem("photo.png").querySelector("img.upsure-preview");
    expect(preview?.getAttribute("src")).toBe("blob:preview-1");
    // Decorative: the file name is right next to it.
    expect(preview?.getAttribute("alt")).toBe("");
    expect(fileItem("notes.txt").querySelector("img")).toBeNull();
  });

  test("the progress bar values update", () => {
    const { dropzone } = renderUpsure();
    drop(dropzone, [makeFile("a.bin", "", 1000)]);
    const bar = screen.getByRole("progressbar", { name: "Upload progress of a.bin" });

    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    expect(bar.getAttribute("aria-valuenow")).toBe("0");

    act(() => uploadOf("a.bin").options.onProgress?.(250, 1000));
    expect(bar.getAttribute("aria-valuenow")).toBe("25");
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("25%");
    expect(fileItem("a.bin").querySelector(".upsure-file-status")?.textContent).toBe("Uploading 25%");

    act(() => succeed("a.bin"));
    expect(bar.getAttribute("aria-valuenow")).toBe("100");
    expect(fileItem("a.bin").querySelector(".upsure-file-status")?.textContent).toBe("Uploaded");
  });

  test("a failed file shows why it failed", () => {
    const { dropzone } = renderUpsure();
    drop(dropzone, [makeFile("a.txt")]);

    act(() => fail("a.txt", serverError(413, "File is too large")));

    expect(fileItem("a.txt").querySelector(".upsure-file-status")?.textContent).toBe(
      "Failed: File is too large",
    );
  });

  test("every part has a stable class name and the status as data-status", () => {
    const { root, dropzone } = renderUpsure({ className: "my-uploader" });
    drop(dropzone, [makeFile("a.txt")]);

    expect(root.className).toBe("upsure my-uploader");
    for (const selector of [
      ".upsure-dropzone",
      ".upsure-dropzone-button",
      ".upsure-input",
      ".upsure-files",
      ".upsure-file[data-status=uploading]",
      ".upsure-file-info",
      ".upsure-file-name",
      ".upsure-file-size",
      ".upsure-file-status[data-status=uploading]",
      ".upsure-progress[data-status=uploading]",
      ".upsure-progress-bar",
      ".upsure-actions",
      ".upsure-button.upsure-pause",
      ".upsure-button.upsure-cancel",
      ".upsure-live",
    ]) {
      expect(root.querySelector(selector), selector).not.toBeNull();
    }
  });
});

describe("buttons", () => {
  test("uploading: Pause and Cancel", async () => {
    const user = userEvent.setup();
    const { dropzone } = renderUpsure();
    drop(dropzone, [makeFile("a.txt"), makeFile("b.txt")]);
    expect(buttonNames(fileItem("a.txt"))).toEqual(["Pause a.txt", "Cancel a.txt"]);

    await user.click(screen.getByRole("button", { name: "Pause a.txt" }));
    expect(fileItem("a.txt").dataset.status).toBe("paused");
    expect(uploadOf("a.txt").abort).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Cancel b.txt" }));
    // Cancel deletes the upload on the server and removes the file.
    expect(uploadOf("b.txt").abort).toHaveBeenCalledWith(true);
    expect(screen.queryByText("b.txt")).toBeNull();
  });

  test("paused: Resume and Cancel", async () => {
    const user = userEvent.setup();
    const { dropzone } = renderUpsure();
    drop(dropzone, [makeFile("a.txt")]);
    await user.click(screen.getByRole("button", { name: "Pause a.txt" }));
    expect(buttonNames(fileItem("a.txt"))).toEqual(["Resume a.txt", "Cancel a.txt"]);

    await user.click(screen.getByRole("button", { name: "Resume a.txt" }));

    expect(fileItem("a.txt").dataset.status).toBe("uploading");
    expect(buttonNames(fileItem("a.txt"))).toEqual(["Pause a.txt", "Cancel a.txt"]);
  });

  test("failed: Retry and Remove", async () => {
    const user = userEvent.setup();
    const { dropzone } = renderUpsure();
    drop(dropzone, [makeFile("a.txt"), makeFile("b.txt")]);
    act(() => {
      fail("a.txt", networkError());
      fail("b.txt", networkError());
    });
    expect(buttonNames(fileItem("a.txt"))).toEqual(["Retry a.txt", "Remove a.txt"]);

    await user.click(screen.getByRole("button", { name: "Retry a.txt" }));
    expect(fileItem("a.txt").dataset.status).toBe("uploading");

    await user.click(screen.getByRole("button", { name: "Remove b.txt" }));
    expect(screen.queryByText("b.txt")).toBeNull();
    // Remove only takes it off the list; nothing is deleted on the server.
    expect(uploadOf("b.txt").abort).not.toHaveBeenCalledWith(true);
  });

  test("uploaded: Remove only", async () => {
    const user = userEvent.setup();
    const { dropzone } = renderUpsure();
    drop(dropzone, [makeFile("a.txt")]);
    act(() => succeed("a.txt"));
    expect(buttonNames(fileItem("a.txt"))).toEqual(["Remove a.txt"]);

    await user.click(screen.getByRole("button", { name: "Remove a.txt" }));

    expect(screen.queryByRole("list", { name: "Files" })).toBeNull();
  });

  test("waiting: Remove only", () => {
    const { dropzone } = renderUpsure({ parallelUploads: 1 });

    drop(dropzone, [makeFile("a.txt"), makeFile("b.txt")]);

    expect(fileItem("b.txt").dataset.status).toBe("queued");
    expect(fileItem("b.txt").querySelector(".upsure-file-status")?.textContent).toBe("Waiting");
    expect(buttonNames(fileItem("b.txt"))).toEqual(["Remove b.txt"]);
  });

  test("buttons show a short text and never submit a surrounding form", () => {
    const { dropzone } = renderUpsure();
    drop(dropzone, [makeFile("a.txt")]);

    const pause = screen.getByRole("button", { name: "Pause a.txt" }) as HTMLButtonElement;
    expect(pause.textContent).toBe("Pause");
    expect(pause.type).toBe("button");
  });
});

describe("rejected files", () => {
  test("shows a clear message for each rejected file", () => {
    const onRejected = vi.fn();
    const { dropzone } = renderUpsure({
      allowedTypes: ["image/*", "video/*"],
      maxFileSize: 50 * MB,
      onRejected,
    });

    drop(dropzone, [
      makeFile("photo.exe", "application/x-msdownload"),
      makeFile("video.mp4", "video/mp4", 51 * MB),
      makeFile("empty.png", "image/png", 0),
      makeFile("ok.png", "image/png"),
    ]);

    const messages = within(screen.getByRole("list", { name: "Files that could not be added" }))
      .getAllByRole("listitem")
      .map((item) => item.querySelector(".upsure-rejection-message")?.textContent);
    expect(messages).toEqual([
      "photo.exe: this file type isn't allowed",
      "video.mp4: larger than 50 MB",
      "empty.png: the file is empty",
    ]);
    expect(fileItem("ok.png")).toBeTruthy();
    expect(onRejected).toHaveBeenCalledTimes(1);
  });

  test("says how many files are allowed", () => {
    const { dropzone } = renderUpsure({ maxFiles: 2 });

    drop(dropzone, [makeFile("1.txt"), makeFile("2.txt"), makeFile("3.txt")]);

    expect(rejectionMessage("3.txt: only 2 files are allowed")).not.toBeNull();
  });

  test("a message can be dismissed", async () => {
    const user = userEvent.setup();
    const { dropzone } = renderUpsure({ allowedTypes: [".png"] });
    drop(dropzone, [makeFile("a.exe"), makeFile("b.exe")]);

    await user.click(screen.getByRole("button", { name: "Dismiss the message about a.exe" }));

    expect(rejectionMessage("a.exe: this file type isn't allowed")).toBeNull();
    expect(rejectionMessage("b.exe: this file type isn't allowed")).not.toBeNull();
  });

  test("the next batch of files replaces the old messages", () => {
    const { dropzone } = renderUpsure({ allowedTypes: [".png"] });
    drop(dropzone, [makeFile("a.exe")]);

    drop(dropzone, [makeFile("ok.png", "image/png")]);

    expect(screen.queryByRole("list", { name: "Files that could not be added" })).toBeNull();
  });
});

describe("screen reader announcements", () => {
  test("the live region is polite and starts empty", () => {
    const { live } = renderUpsure();

    expect(live.getAttribute("role")).toBe("status");
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toBe("");
  });

  test("announces a finished upload", () => {
    const { dropzone, live } = renderUpsure();
    drop(dropzone, [makeFile("a.txt")]);
    expect(live.textContent).toBe("");

    act(() => succeed("a.txt"));

    expect(live.textContent).toBe("a.txt uploaded");
  });

  test("announces a failed upload with the reason", () => {
    const { dropzone, live } = renderUpsure();
    drop(dropzone, [makeFile("a.txt")]);

    act(() => fail("a.txt", serverError(415, "File type not allowed")));

    expect(live.textContent).toBe("a.txt failed: File type not allowed");
  });

  test("announces rejected files", () => {
    const { dropzone, live } = renderUpsure({ allowedTypes: [".png"] });

    drop(dropzone, [makeFile("a.exe"), makeFile("b.exe")]);

    expect(live.textContent).toBe(
      "a.exe: this file type isn't allowed. b.exe: this file type isn't allowed",
    );
  });

  test("progress alone is not announced", () => {
    const { dropzone, live } = renderUpsure();
    drop(dropzone, [makeFile("a.bin", "", 1000)]);

    act(() => uploadOf("a.bin").options.onProgress?.(500, 1000));

    expect(live.textContent).toBe("");
  });
});

describe("labels", () => {
  test("override the default texts", async () => {
    const user = userEvent.setup();
    const { dropzone, button, live } = renderUpsure({
      allowedTypes: [".txt"],
      labels: {
        dropzone: "Dateien hierher ziehen",
        fileList: "Dateien",
        rejectionList: "Abgelehnte Dateien",
        statusUploading: "Wird hochgeladen",
        statusPaused: "Pausiert",
        statusComplete: "Hochgeladen",
        pause: "Pause",
        resume: "Fortsetzen",
        pauseFile: (name) => `${name} pausieren`,
        resumeFile: (name) => `${name} fortsetzen`,
        progressOf: (name) => `Fortschritt von ${name}`,
        rejectedType: "Dateityp nicht erlaubt",
        announceComplete: (name) => `${name} hochgeladen`,
      },
    });
    expect(button.textContent).toBe("Dateien hierher ziehen");

    drop(dropzone, [makeFile("a.txt"), makeFile("b.exe")]);

    expect(screen.getByRole("list", { name: "Dateien" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Abgelehnte Dateien" })).toBeTruthy();
    expect(rejectionMessage("b.exe: Dateityp nicht erlaubt")).not.toBeNull();
    expect(screen.getByRole("progressbar", { name: "Fortschritt von a.txt" })).toBeTruthy();
    expect(fileItem("a.txt").querySelector(".upsure-file-status")?.textContent).toBe(
      "Wird hochgeladen 0%",
    );

    await user.click(screen.getByRole("button", { name: "a.txt pausieren" }));
    expect(screen.getByRole("button", { name: "a.txt fortsetzen" }).textContent).toBe("Fortsetzen");
    expect(fileItem("a.txt").querySelector(".upsure-file-status")?.textContent).toBe("Pausiert 0%");

    await user.click(screen.getByRole("button", { name: "a.txt fortsetzen" }));
    act(() => succeed("a.txt"));
    expect(live.textContent).toBe("a.txt hochgeladen");
    // Texts that were not overridden keep their defaults.
    expect(screen.getByRole("button", { name: "Remove a.txt" })).toBeTruthy();
  });
});

describe("accessibility", () => {
  /** jsdom has no layout or colours, so the checks that need them can't run here. */
  const check = (element: Element) =>
    axe.run(element, { rules: { "color-contrast": { enabled: false } } });

  beforeEach(() => {
    // axe probes <canvas>, which jsdom doesn't implement and complains about loudly.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  test("axe finds no violations in the empty component", async () => {
    const { container } = renderUpsure();

    const results = await check(container);

    expect(results.violations).toEqual([]);
    expect(results.passes.length).toBeGreaterThan(0);
  });

  test("axe finds no violations with files in every status and rejection messages", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview-1");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const user = userEvent.setup();
    const { container, dropzone } = renderUpsure({ parallelUploads: 4, maxFileSize: 50 * MB });
    drop(dropzone, [
      makeFile("uploading.png", "image/png"),
      makeFile("paused.txt"),
      makeFile("done.txt"),
      makeFile("failed.txt"),
      makeFile("waiting.txt"),
      makeFile("huge.mov", "video/quicktime", 51 * MB),
    ]);
    act(() => uploadOf("uploading.png").options.onProgress?.(400, 1000));
    await user.click(screen.getByRole("button", { name: "Pause paused.txt" }));
    act(() => {
      succeed("done.txt");
      fail("failed.txt", networkError());
    });
    // Every status is on screen (waiting.txt took the slot paused.txt freed), plus a rejection.
    expect(
      Array.from(container.querySelectorAll(".upsure-file")).map(
        (item) => (item as HTMLElement).dataset.status,
      ),
    ).toEqual(["uploading", "paused", "complete", "error", "uploading"]);
    expect(tus.uploads).toHaveLength(5);

    const results = await check(container);

    expect(results.violations).toEqual([]);
  });

  test("axe finds no violations while disabled and while dragging", async () => {
    const { container, dropzone, rerender } = renderUpsure();
    fireEvent.dragEnter(dropzone);
    expect((await check(container)).violations).toEqual([]);

    rerender(<Upsure endpoint={endpoint} disabled />);
    expect((await check(container)).violations).toEqual([]);
  });
});
