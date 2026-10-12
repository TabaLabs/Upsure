import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fail, networkError, resetTus, serverError, succeed, tus, uploadOf } from "../../core/test/fake-tus";
import { type UseUpsureOptions, useUpsure } from "../src/index";

// tus-js-client is replaced by the core's fake for every test in this package
// (see vitest.config.ts), so nothing here touches the network.

const endpoint = "https://example.test/uploads";

/** A File with a faked size, so tests can use round numbers. */
function makeFile(name: string, type = "text/plain", size = 1000): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function renderUpsure(options: Partial<UseUpsureOptions> = {}, strict = false) {
  return renderHook((props: Partial<UseUpsureOptions>) => useUpsure({ endpoint, ...props }), {
    initialProps: options,
    wrapper: strict ? StrictMode : undefined,
  });
}

/** How many "online" listeners are registered on window right now. */
function trackOnlineListeners() {
  const live = new Set<unknown>();
  const add = window.addEventListener.bind(window);
  const remove = window.removeEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
    if (type === "online") live.add(listener);
    add(type, listener as EventListener, options);
  });
  vi.spyOn(window, "removeEventListener").mockImplementation((type, listener, options) => {
    if (type === "online") live.delete(listener);
    remove(type, listener as EventListener, options);
  });
  return () => live.size;
}

beforeEach(resetTus);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("files", () => {
  test("starts with no files and an uploader", () => {
    const { result } = renderUpsure();

    expect(result.current.files).toEqual([]);
    expect(result.current.totalProgress).toBe(0);
    expect(result.current.isUploading).toBe(false);
    expect(result.current.uploader).not.toBeNull();
  });

  test("updates when files are added", () => {
    const { result } = renderUpsure();

    let added: ReturnType<typeof result.current.addFiles> | undefined;
    act(() => {
      added = result.current.addFiles([makeFile("a.txt"), makeFile("b.txt")]);
    });

    expect(added?.accepted.map((file) => file.name)).toEqual(["a.txt", "b.txt"]);
    expect(result.current.files.map((file) => [file.name, file.status])).toEqual([
      ["a.txt", "uploading"],
      ["b.txt", "uploading"],
    ]);
  });

  test("updates when progress changes", () => {
    const { result } = renderUpsure();
    act(() => {
      result.current.addFiles([makeFile("a.txt")]);
    });

    act(() => uploadOf("a.txt").options.onProgress?.(250, 1000));

    expect(result.current.files[0]).toMatchObject({ progress: 0.25, bytesUploaded: 250 });
  });

  test("updates when an upload completes or fails", () => {
    const { result } = renderUpsure();
    act(() => {
      result.current.addFiles([makeFile("ok.txt"), makeFile("bad.txt")]);
    });

    act(() => {
      succeed("ok.txt", `${endpoint}/abc`);
      fail("bad.txt", serverError(415, "File type not allowed"));
    });

    expect(result.current.files).toMatchObject([
      { name: "ok.txt", status: "complete", progress: 1, url: `${endpoint}/abc` },
      { name: "bad.txt", status: "error", error: "File type not allowed", retryable: false },
    ]);
  });

  test("the files array keeps its identity while nothing changes", () => {
    const { result, rerender } = renderUpsure();
    act(() => {
      result.current.addFiles([makeFile("a.txt")]);
    });
    const before = result.current.files;

    rerender({});

    expect(result.current.files).toBe(before);
  });
});

describe("actions", () => {
  test("pause, resume, retry, remove, cancel and clear reach the uploader", () => {
    const { result } = renderUpsure();
    act(() => {
      result.current.addFiles([makeFile("a.txt"), makeFile("b.txt"), makeFile("c.txt")]);
    });
    const [a, b, c] = result.current.files.map((file) => file.id) as [string, string, string];
    const status = (id: string) => result.current.files.find((file) => file.id === id)?.status;

    act(() => result.current.pause(a));
    expect(status(a)).toBe("paused");

    act(() => result.current.resume(a));
    expect(status(a)).toBe("uploading");

    act(() => fail("b.txt", networkError()));
    expect(status(b)).toBe("error");
    act(() => result.current.retry(b));
    expect(status(b)).toBe("uploading");

    act(() => result.current.remove(a));
    expect(result.current.files.map((file) => file.name)).toEqual(["b.txt", "c.txt"]);

    act(() => result.current.cancel(c));
    expect(uploadOf("c.txt").abort).toHaveBeenCalledWith(true);
    expect(result.current.files.map((file) => file.name)).toEqual(["b.txt"]);

    act(() => result.current.clear());
    expect(result.current.files).toEqual([]);
  });

  test("start() starts queued files when autoStart is off", () => {
    const { result } = renderUpsure({ autoStart: false });
    act(() => {
      result.current.addFiles([makeFile("a.txt"), makeFile("b.txt")]);
    });
    expect(result.current.isUploading).toBe(false);

    act(() => result.current.start(result.current.files[1]?.id));
    expect(result.current.files.map((file) => file.status)).toEqual(["queued", "uploading"]);

    act(() => result.current.start());
    expect(result.current.files.map((file) => file.status)).toEqual(["uploading", "uploading"]);
  });

  test("the action functions keep their identity across renders", () => {
    const { result, rerender } = renderUpsure();
    const before = result.current;

    rerender({ onComplete: () => {} });

    for (const name of ["addFiles", "start", "pause", "resume", "cancel", "retry", "remove", "clear"] as const) {
      expect(result.current[name]).toBe(before[name]);
    }
  });
});

describe("totalProgress and isUploading", () => {
  test("totalProgress is weighted by file size", () => {
    const { result } = renderUpsure();
    act(() => {
      result.current.addFiles([makeFile("small.bin", "", 1000), makeFile("big.bin", "", 3000)]);
    });
    expect(result.current.totalProgress).toBe(0);

    act(() => uploadOf("small.bin").options.onProgress?.(500, 1000));
    expect(result.current.totalProgress).toBe(0.125);

    act(() => succeed("small.bin"));
    expect(result.current.totalProgress).toBe(0.25);

    act(() => uploadOf("big.bin").options.onProgress?.(1500, 3000));
    expect(result.current.totalProgress).toBe(0.625);

    act(() => succeed("big.bin"));
    expect(result.current.totalProgress).toBe(1);
  });

  test("isUploading is true only while a file is uploading", () => {
    const { result } = renderUpsure();
    expect(result.current.isUploading).toBe(false);

    act(() => {
      result.current.addFiles([makeFile("a.txt"), makeFile("b.txt")]);
    });
    expect(result.current.isUploading).toBe(true);

    act(() => succeed("a.txt"));
    expect(result.current.isUploading).toBe(true);

    act(() => result.current.pause(result.current.files[1]?.id as string));
    expect(result.current.isUploading).toBe(false);

    act(() => result.current.resume(result.current.files[1]?.id as string));
    expect(result.current.isUploading).toBe(true);

    act(() => fail("b.txt", networkError()));
    expect(result.current.isUploading).toBe(false);
  });

  test("both go back to their start values after clear()", () => {
    const { result } = renderUpsure();
    act(() => {
      result.current.addFiles([makeFile("a.bin", "", 1000)]);
    });
    act(() => uploadOf("a.bin").options.onProgress?.(500, 1000));

    act(() => result.current.clear());

    expect(result.current.totalProgress).toBe(0);
    expect(result.current.isUploading).toBe(false);
  });
});

describe("callbacks", () => {
  test("onComplete, onError and onRejected are called", () => {
    const onComplete = vi.fn();
    const onError = vi.fn();
    const onRejected = vi.fn();
    const { result } = renderUpsure({ onComplete, onError, onRejected, maxFileSize: 2000 });
    const tooBig = makeFile("big.bin", "", 5000);

    act(() => {
      result.current.addFiles([makeFile("ok.txt"), makeFile("bad.txt"), tooBig]);
    });
    const error = networkError();
    act(() => {
      succeed("ok.txt");
      fail("bad.txt", error);
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0]?.[0]).toMatchObject({ name: "ok.txt", status: "complete" });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ name: "bad.txt", status: "error" });
    expect(onError.mock.calls[0]?.[1]).toBe(error);
    expect(onRejected).toHaveBeenCalledTimes(1);
    expect(onRejected).toHaveBeenCalledWith([{ file: tooBig, reason: "size" }]);
  });

  test("onRejected is not called when every file is accepted", () => {
    const onRejected = vi.fn();
    const { result } = renderUpsure({ onRejected });

    act(() => {
      result.current.addFiles([makeFile("ok.txt")]);
    });

    expect(onRejected).not.toHaveBeenCalled();
  });

  test("the latest callbacks are used after a re-render, without a new uploader", () => {
    const first = { onComplete: vi.fn(), onError: vi.fn(), onRejected: vi.fn() };
    const second = { onComplete: vi.fn(), onError: vi.fn(), onRejected: vi.fn() };
    const { result, rerender } = renderUpsure({ ...first, maxFiles: 2 });
    const uploader = result.current.uploader;
    act(() => {
      result.current.addFiles([makeFile("ok.txt"), makeFile("bad.txt")]);
    });

    rerender({ ...second, maxFiles: 2 });
    act(() => {
      succeed("ok.txt");
      fail("bad.txt", networkError());
      result.current.addFiles([makeFile("one-too-many.txt")]);
    });

    expect(second.onComplete).toHaveBeenCalledTimes(1);
    expect(second.onError).toHaveBeenCalledTimes(1);
    expect(second.onRejected).toHaveBeenCalledTimes(1);
    expect(first.onComplete).not.toHaveBeenCalled();
    expect(first.onError).not.toHaveBeenCalled();
    expect(first.onRejected).not.toHaveBeenCalled();
    // Same uploader, same uploads: nothing was recreated.
    expect(result.current.uploader).toBe(uploader);
    expect(tus.uploads).toHaveLength(2);
  });

  test("a callback that is removed later is simply not called", () => {
    const onComplete = vi.fn();
    const { result, rerender } = renderUpsure({ onComplete });
    act(() => {
      result.current.addFiles([makeFile("ok.txt")]);
    });

    rerender({});
    act(() => succeed("ok.txt"));

    expect(onComplete).not.toHaveBeenCalled();
    expect(result.current.files[0]?.status).toBe("complete");
  });
});

describe("lifecycle", () => {
  test("the uploader is created once and kept across re-renders", () => {
    const liveListeners = trackOnlineListeners();
    const { result, rerender } = renderUpsure();
    const uploader = result.current.uploader;

    rerender({ chunkSize: 123 });
    rerender({ onComplete: () => {} });

    expect(result.current.uploader).toBe(uploader);
    expect(liveListeners()).toBe(1);
  });

  test("unmount destroys the uploader", () => {
    const liveListeners = trackOnlineListeners();
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview-1");
    const { result, unmount } = renderUpsure();
    act(() => {
      result.current.addFiles([makeFile("photo.png", "image/png")]);
    });
    const uploader = result.current.uploader;
    expect(liveListeners()).toBe(1);

    unmount();

    // Listeners, uploads and preview URLs are all released.
    expect(liveListeners()).toBe(0);
    expect(uploadOf("photo.png").abort).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("blob:preview-1");
    expect(uploader?.getState().files).toEqual([]);
  });

  test("events after unmount don't cause errors or callbacks", () => {
    const onComplete = vi.fn();
    const { result, unmount } = renderUpsure({ onComplete });
    act(() => {
      result.current.addFiles([makeFile("a.txt")]);
    });

    unmount();
    succeed("a.txt");

    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe("StrictMode", () => {
  test("ends up with exactly one live uploader", () => {
    const liveListeners = trackOnlineListeners();

    const { result } = renderUpsure({}, true);

    expect(liveListeners()).toBe(1);
    expect(result.current.uploader).not.toBeNull();
  });

  test("uploads still run and report back once", () => {
    const onComplete = vi.fn();
    const { result } = renderUpsure({ onComplete }, true);

    act(() => {
      result.current.addFiles([makeFile("a.bin", "", 1000)]);
    });
    expect(result.current.files).toMatchObject([{ name: "a.bin", status: "uploading" }]);
    // One file, one upload: nothing was added twice.
    expect(tus.uploads).toHaveLength(1);

    act(() => uploadOf("a.bin").options.onProgress?.(500, 1000));
    expect(result.current.totalProgress).toBe(0.5);

    act(() => succeed("a.bin"));
    expect(result.current.files[0]?.status).toBe("complete");
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  test("the uploader in use is not a destroyed one", () => {
    const { result } = renderUpsure({}, true);
    act(() => {
      result.current.addFiles([makeFile("a.txt")]);
    });
    act(() => fail("a.txt", networkError()));

    // A destroyed uploader no longer listens for "online"; a live one retries.
    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(result.current.files[0]?.status).toBe("uploading");
  });

  test("unmount releases everything", () => {
    const liveListeners = trackOnlineListeners();
    const { unmount } = renderUpsure({}, true);

    unmount();

    expect(liveListeners()).toBe(0);
  });
});
