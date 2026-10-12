import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createUploader, type Uploader } from "../src/index";
import {
  fail,
  flush,
  networkError,
  resetTus,
  serverError,
  succeed,
  tus,
  uploadOf,
} from "./fake-tus";
import { makeFile } from "./helpers";

vi.mock("tus-js-client", () => import("./fake-tus"));

const endpoint = "https://example.test/uploads";
const uploaders: Uploader[] = [];

/** createUploader, destroyed after the test so no "online" listener is left behind. */
function create(options: Partial<Parameters<typeof createUploader>[0]> = {}): Uploader {
  const uploader = createUploader({ endpoint, ...options });
  uploaders.push(uploader);
  return uploader;
}

beforeEach(resetTus);

afterEach(() => {
  for (const uploader of uploaders.splice(0)) uploader.destroy();
  vi.restoreAllMocks();
});

const statuses = (uploader: Uploader) =>
  Object.fromEntries(uploader.getState().files.map((file) => [file.name, file.status]));

/** Adds files and returns their ids, in order. */
function add(uploader: Uploader, ...files: File[]): string[] {
  return uploader.addFiles(files).accepted.map((file) => file.id);
}

describe("pause", () => {
  test("stops the upload locally and keeps the progress", () => {
    const uploader = create();
    const [id] = add(uploader, makeFile("a.bin", "", 1000)) as [string];
    uploadOf("a.bin").options.onProgress?.(400, 1000);

    uploader.pause(id);

    expect(uploader.getState().files[0]).toMatchObject({
      status: "paused",
      progress: 0.4,
      bytesUploaded: 400,
    });
    expect(uploadOf("a.bin").abort).toHaveBeenCalledTimes(1);
    // Not terminated: the partial upload stays on the server.
    expect(uploadOf("a.bin").abort.mock.calls[0]?.[0]).toBeFalsy();
  });

  test("frees the slot for the next file", () => {
    const uploader = create({ parallelUploads: 1 });
    const [first] = add(uploader, makeFile("1.txt"), makeFile("2.txt")) as [string];

    uploader.pause(first);

    expect(statuses(uploader)).toEqual({ "1.txt": "paused", "2.txt": "uploading" });
  });

  test("events that arrive while paused are ignored", () => {
    const onError = vi.fn();
    const uploader = create({ onError });
    const [id] = add(uploader, makeFile("a.bin", "", 1000)) as [string];
    uploadOf("a.bin").options.onProgress?.(400, 1000);
    uploader.pause(id);

    uploadOf("a.bin").options.onProgress?.(600, 1000);
    fail("a.bin", networkError());

    expect(uploader.getState().files[0]).toMatchObject({ status: "paused", bytesUploaded: 400 });
    expect(onError).not.toHaveBeenCalled();
  });

  test("a file that is waiting for a slot can be paused, and then doesn't start", () => {
    const uploader = create({ parallelUploads: 1 });
    const [, second] = add(uploader, makeFile("1.txt"), makeFile("2.txt")) as [string, string];

    uploader.pause(second);
    succeed("1.txt");

    expect(statuses(uploader)).toEqual({ "1.txt": "complete", "2.txt": "paused" });
    expect(tus.uploads).toHaveLength(1);
  });

  test("does nothing for finished, failed or unknown files", () => {
    const uploader = create();
    const [done, failed] = add(uploader, makeFile("done.txt"), makeFile("failed.txt")) as [
      string,
      string,
    ];
    succeed("done.txt");
    fail("failed.txt", serverError(415, "no"));
    const before = uploader.getState();

    uploader.pause(done);
    uploader.pause(failed);
    uploader.pause("no-such-id");

    expect(uploader.getState()).toBe(before);
  });
});

describe("resume", () => {
  test("continues the same tus upload instead of starting a new one", async () => {
    const uploader = create();
    const [id] = add(uploader, makeFile("a.bin", "", 1000)) as [string];
    await flush();
    uploadOf("a.bin").options.onProgress?.(400, 1000);
    uploader.pause(id);

    uploader.resume(id);
    await flush();

    // Progress is kept, not reset to 0.
    expect(uploader.getState().files[0]).toMatchObject({
      status: "uploading",
      progress: 0.4,
      bytesUploaded: 400,
    });
    // One tus upload, started twice: tus continues from the server's offset.
    expect(tus.uploads).toHaveLength(1);
    expect(uploadOf("a.bin").start).toHaveBeenCalledTimes(2);
  });

  test("waits for a free slot", () => {
    const uploader = create({ parallelUploads: 1 });
    const [first] = add(uploader, makeFile("1.txt"), makeFile("2.txt")) as [string];
    uploader.pause(first);

    uploader.resume(first);
    expect(statuses(uploader)).toEqual({ "1.txt": "queued", "2.txt": "uploading" });

    succeed("2.txt");
    expect(statuses(uploader)).toEqual({ "1.txt": "uploading", "2.txt": "complete" });
  });

  test("a resumed upload can finish", () => {
    const onComplete = vi.fn();
    const uploader = create({ onComplete });
    const [id] = add(uploader, makeFile("a.bin", "", 1000)) as [string];
    uploader.pause(id);
    uploader.resume(id);

    succeed("a.bin");

    expect(uploader.getState().files[0]).toMatchObject({ status: "complete", progress: 1 });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  test("only works on paused files", async () => {
    const uploader = create({ autoStart: false });
    const [queued] = add(uploader, makeFile("queued.txt")) as [string];
    const before = uploader.getState();

    uploader.resume(queued);
    uploader.resume("no-such-id");
    await flush();

    expect(uploader.getState()).toBe(before);
    expect(tus.uploads).toHaveLength(0);
  });
});

describe("cancel", () => {
  test("stops the upload, deletes it on the server and removes the file", () => {
    const uploader = create({ parallelUploads: 1 });
    const [first] = add(uploader, makeFile("1.txt"), makeFile("2.txt")) as [string];

    uploader.cancel(first);

    expect(uploadOf("1.txt").abort).toHaveBeenCalledTimes(1);
    expect(uploadOf("1.txt").abort).toHaveBeenCalledWith(true);
    // The file is gone and the next one takes its slot.
    expect(statuses(uploader)).toEqual({ "2.txt": "uploading" });
  });

  test.each(["paused", "error"] as const)("deletes a %s upload on the server too", (status) => {
    const uploader = create();
    const [id] = add(uploader, makeFile("a.txt")) as [string];
    if (status === "paused") uploader.pause(id);
    else fail("a.txt", networkError());
    uploadOf("a.txt").abort.mockClear();

    uploader.cancel(id);

    expect(uploadOf("a.txt").abort).toHaveBeenCalledWith(true);
    expect(uploader.getState().files).toEqual([]);
  });

  test("doesn't delete a finished upload from the server", () => {
    const uploader = create();
    const [id] = add(uploader, makeFile("a.txt")) as [string];
    succeed("a.txt");

    uploader.cancel(id);

    expect(uploadOf("a.txt").abort).toHaveBeenCalledWith(false);
    expect(uploader.getState().files).toEqual([]);
  });

  test("removes a file that never started", () => {
    const uploader = create({ autoStart: false });
    const [id] = add(uploader, makeFile("a.txt")) as [string];

    uploader.cancel(id);

    expect(uploader.getState().files).toEqual([]);
    expect(tus.uploads).toHaveLength(0);
  });

  test("events from a cancelled upload are ignored", () => {
    const onComplete = vi.fn();
    const uploader = create({ onComplete });
    const [id] = add(uploader, makeFile("a.txt")) as [string];
    uploader.cancel(id);

    succeed("a.txt");

    expect(uploader.getState().files).toEqual([]);
    expect(onComplete).not.toHaveBeenCalled();
  });

  test("does nothing for an unknown id", () => {
    const uploader = create();
    add(uploader, makeFile("a.txt"));
    const listener = vi.fn();
    uploader.subscribe(listener);

    uploader.cancel("no-such-id");

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("retry", () => {
  test("restarts a failed file with the same tus upload and clears the error", async () => {
    const uploader = create();
    const [id] = add(uploader, makeFile("a.bin", "", 1000)) as [string];
    await flush();
    uploadOf("a.bin").options.onProgress?.(300, 1000);
    fail("a.bin", networkError());
    expect(uploader.getState().files[0]).toMatchObject({ status: "error", retryable: true });

    uploader.retry(id);
    await flush();

    const file = uploader.getState().files[0];
    expect(file).toMatchObject({ status: "uploading", bytesUploaded: 300 });
    expect(file).not.toHaveProperty("error");
    expect(file).not.toHaveProperty("retryable");
    // Same tus upload, so it continues from the offset the server has.
    expect(tus.uploads).toHaveLength(1);
    expect(uploadOf("a.bin").start).toHaveBeenCalledTimes(2);
  });

  test("also works for a file the server rejected", () => {
    const uploader = create();
    const [id] = add(uploader, makeFile("a.txt")) as [string];
    fail("a.txt", serverError(401, "Unauthorized"));

    uploader.retry(id);

    expect(statuses(uploader)).toEqual({ "a.txt": "uploading" });
  });

  test("waits for a free slot", () => {
    const uploader = create({ parallelUploads: 1 });
    const [first] = add(uploader, makeFile("1.txt"), makeFile("2.txt")) as [string];
    fail("1.txt", networkError());
    expect(statuses(uploader)).toEqual({ "1.txt": "error", "2.txt": "uploading" });

    uploader.retry(first);
    expect(statuses(uploader)).toEqual({ "1.txt": "queued", "2.txt": "uploading" });
    expect(uploader.getState().files[0]).not.toHaveProperty("error");

    succeed("2.txt");
    expect(statuses(uploader)).toEqual({ "1.txt": "uploading", "2.txt": "complete" });
  });

  test("a retried upload can fail again and report it", () => {
    const onError = vi.fn();
    const uploader = create({ onError });
    const [id] = add(uploader, makeFile("a.txt")) as [string];
    fail("a.txt", networkError());
    uploader.retry(id);

    fail("a.txt", serverError(413, ""));

    expect(uploader.getState().files[0]).toMatchObject({
      status: "error",
      error: "Upload failed with status 413",
      retryable: false,
    });
    expect(onError).toHaveBeenCalledTimes(2);
  });

  test("only works on files in error status", () => {
    const uploader = create();
    const [uploading, done] = add(uploader, makeFile("up.txt"), makeFile("done.txt")) as [
      string,
      string,
    ];
    succeed("done.txt");
    const before = uploader.getState();

    uploader.retry(uploading);
    uploader.retry(done);
    uploader.retry("no-such-id");

    expect(uploader.getState()).toBe(before);
  });
});

describe("auto-retry when the browser comes back online", () => {
  const goOnline = () => window.dispatchEvent(new Event("online"));

  test("retries files that failed because of the network", async () => {
    const uploader = create();
    add(uploader, makeFile("a.txt"));
    await flush();
    fail("a.txt", networkError());

    goOnline();
    await flush();

    expect(statuses(uploader)).toEqual({ "a.txt": "uploading" });
    expect(uploadOf("a.txt").start).toHaveBeenCalledTimes(2);
  });

  test.each([413, 415, 401])("never retries a file the server rejected with %i", async (status) => {
    const uploader = create();
    add(uploader, makeFile("rejected.txt"), makeFile("offline.txt"));
    await flush();
    fail("rejected.txt", serverError(status, "no"));
    fail("offline.txt", networkError());

    goOnline();
    await flush();

    expect(statuses(uploader)).toEqual({ "rejected.txt": "error", "offline.txt": "uploading" });
    expect(uploadOf("rejected.txt").start).toHaveBeenCalledTimes(1);
    expect(uploader.getState().files[0]).toMatchObject({ error: "no", retryable: false });
  });

  test("leaves uploading, paused, queued and finished files alone", () => {
    const uploader = create({ parallelUploads: 2 });
    const [, paused] = add(
      uploader,
      makeFile("uploading.txt"),
      makeFile("paused.txt"),
      makeFile("done.txt"),
      makeFile("other.txt"),
      makeFile("queued.txt"),
    ) as [string, string];
    uploader.pause(paused);
    succeed("done.txt");
    expect(statuses(uploader)).toEqual({
      "uploading.txt": "uploading",
      "paused.txt": "paused",
      "done.txt": "complete",
      "other.txt": "uploading",
      "queued.txt": "queued",
    });
    const before = uploader.getState();

    goOnline();

    expect(uploader.getState()).toBe(before);
  });

  test("respects parallelUploads", () => {
    const uploader = create({ parallelUploads: 1 });
    add(uploader, makeFile("1.txt"), makeFile("2.txt"));
    fail("1.txt", networkError());
    fail("2.txt", networkError());

    goOnline();

    expect(statuses(uploader)).toEqual({ "1.txt": "uploading", "2.txt": "queued" });
  });

  test("destroy() removes the online listener", async () => {
    const removeListener = vi.spyOn(window, "removeEventListener");
    const addListener = vi.spyOn(window, "addEventListener");
    const uploader = createUploader({ endpoint });
    const listener = addListener.mock.calls.find(([type]) => type === "online")?.[1];
    expect(listener).toBeTypeOf("function");
    uploader.addFiles([makeFile("a.txt")]);
    await flush();
    fail("a.txt", networkError());

    uploader.destroy();
    goOnline();
    await flush();

    expect(removeListener).toHaveBeenCalledWith("online", listener);
    expect(uploadOf("a.txt").start).toHaveBeenCalledTimes(1);
  });
});

describe("resumeAfterReload", () => {
  test("is on by default: tus stores the upload and forgets it when it is done", () => {
    add(create(), makeFile("a.txt"));

    expect(uploadOf("a.txt").options).toMatchObject({
      storeFingerprintForResuming: true,
      removeFingerprintOnSuccess: true,
    });
  });

  test("continues a stored upload of the same file", async () => {
    tus.previous = [
      {
        size: 1000,
        metadata: {},
        creationTime: "2026-10-01T10:00:00.000Z",
        uploadUrl: `${endpoint}/older`,
        urlStorageKey: "tus::a::1",
      },
      {
        size: 1000,
        metadata: {},
        creationTime: "2026-10-02T10:00:00.000Z",
        uploadUrl: `${endpoint}/newest`,
        urlStorageKey: "tus::a::2",
      },
    ] as never;
    add(create(), makeFile("a.bin", "", 1000));
    const upload = uploadOf("a.bin");

    // The lookup comes first; the upload only starts once it is done.
    expect(upload.start).not.toHaveBeenCalled();
    await flush();

    expect(upload.resumeFromPreviousUpload).toHaveBeenCalledTimes(1);
    expect(upload.resumeFromPreviousUpload).toHaveBeenCalledWith(tus.previous[1]);
    expect(upload.url).toBe(`${endpoint}/newest`);
    expect(upload.start).toHaveBeenCalledTimes(1);
    expect(upload.resumeFromPreviousUpload.mock.invocationCallOrder[0]).toBeLessThan(
      upload.start.mock.invocationCallOrder[0] as number,
    );
  });

  test("starts a new upload when nothing is stored", async () => {
    add(create(), makeFile("a.txt"));
    await flush();

    expect(uploadOf("a.txt").resumeFromPreviousUpload).not.toHaveBeenCalled();
    expect(uploadOf("a.txt").start).toHaveBeenCalledTimes(1);
  });

  test("still uploads when the stored uploads can't be read", async () => {
    tus.lookupError = new Error("storage is broken");

    const uploader = create();
    add(uploader, makeFile("a.txt"));
    await flush();

    expect(uploadOf("a.txt").start).toHaveBeenCalledTimes(1);
    expect(statuses(uploader)).toEqual({ "a.txt": "uploading" });
  });

  test("when off, nothing is stored or looked up and the upload starts right away", () => {
    add(create({ resumeAfterReload: false }), makeFile("a.txt"));
    const upload = uploadOf("a.txt");

    expect(upload.options.storeFingerprintForResuming).toBe(false);
    expect(upload.findPreviousUploads).not.toHaveBeenCalled();
    expect(upload.start).toHaveBeenCalledTimes(1);
  });

  test("a file paused before the lookup finished doesn't start", async () => {
    const uploader = create();
    const [id] = add(uploader, makeFile("a.txt")) as [string];

    uploader.pause(id);
    await flush();
    expect(uploadOf("a.txt").start).not.toHaveBeenCalled();

    uploader.resume(id);
    await flush();
    expect(uploadOf("a.txt").start).toHaveBeenCalledTimes(1);
  });
});

describe("previews", () => {
  let created: string[];
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    created = [];
    createObjectURL = vi.fn(() => {
      const url = `blob:preview-${created.length + 1}`;
      created.push(url);
      return url;
    });
    revokeObjectURL = vi.fn();
    vi.spyOn(URL, "createObjectURL").mockImplementation(createObjectURL as never);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(revokeObjectURL as never);
  });

  const revoked = () => revokeObjectURL.mock.calls.map(([url]) => url as string);

  test("image files get a previewUrl made from the file", () => {
    const uploader = create();
    const photo = makeFile("photo.png", "image/png");

    const { accepted } = uploader.addFiles([photo]);

    expect(accepted[0]?.previewUrl).toBe("blob:preview-1");
    expect(uploader.getState().files[0]?.previewUrl).toBe("blob:preview-1");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledWith(photo);
  });

  test("other files get no previewUrl", () => {
    const uploader = create();

    uploader.addFiles([makeFile("doc.pdf", "application/pdf"), makeFile("photo.png")]);

    expect(uploader.getState().files.every((file) => !("previewUrl" in file))).toBe(true);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  test("rejected files get no preview", () => {
    const uploader = create({ maxFileSize: 10 });

    uploader.addFiles([makeFile("big.png", "image/png", 11)]);

    expect(createObjectURL).not.toHaveBeenCalled();
  });

  test("previews: false turns them off", () => {
    const uploader = create({ previews: false });

    uploader.addFiles([makeFile("photo.png", "image/png")]);

    expect(uploader.getState().files[0]).not.toHaveProperty("previewUrl");
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  test("the preview is kept while uploading, paused and after completion", () => {
    const uploader = create();
    const [id] = add(uploader, makeFile("photo.png", "image/png")) as [string];

    uploader.pause(id);
    uploader.resume(id);
    succeed("photo.png");

    expect(uploader.getState().files[0]).toMatchObject({
      status: "complete",
      previewUrl: "blob:preview-1",
    });
    expect(revoked()).toEqual([]);
  });

  test.each(["remove", "cancel"] as const)("%s revokes the preview of that file only", (method) => {
    const uploader = create();
    const [first] = add(
      uploader,
      makeFile("1.png", "image/png"),
      makeFile("2.png", "image/png"),
    ) as [string];

    uploader[method](first);

    expect(revoked()).toEqual(["blob:preview-1"]);
  });

  test.each(["clear", "destroy"] as const)("%s revokes every preview", (method) => {
    const uploader = create();
    add(
      uploader,
      makeFile("1.png", "image/png"),
      makeFile("notes.txt", "text/plain"),
      makeFile("2.png", "image/png"),
    );

    uploader[method]();

    expect(revoked().sort()).toEqual(["blob:preview-1", "blob:preview-2"]);
  });

  test("a preview is never revoked twice", () => {
    const uploader = create();
    const [id] = add(uploader, makeFile("1.png", "image/png")) as [string];

    uploader.remove(id);
    uploader.remove(id);
    uploader.cancel(id);
    uploader.clear();
    uploader.destroy();

    expect(revoked()).toEqual(["blob:preview-1"]);
  });
});
