import { beforeEach, describe, expect, test, vi } from "vitest";
import { createUploader } from "../src/index";
import { flush, networkError, resetTus, serverError, succeed, tus, uploadOf } from "./fake-tus";
import { makeFile } from "./helpers";

vi.mock("tus-js-client", () => import("./fake-tus"));

beforeEach(resetTus);

const endpoint = "https://example.test/uploads";

const statuses = (uploader: ReturnType<typeof createUploader>) =>
  Object.fromEntries(uploader.getState().files.map((file) => [file.name, file.status]));

describe("starting", () => {
  test("files start as soon as they are added by default", async () => {
    const uploader = createUploader({ endpoint });
    const file = makeFile("a.txt", "text/plain");

    const { accepted } = uploader.addFiles([file]);

    expect(accepted[0]?.status).toBe("queued");
    expect(uploader.getState().files[0]?.status).toBe("uploading");
    expect(tus.uploads).toHaveLength(1);
    expect(uploadOf("a.txt").file).toBe(file);
    await flush();
    expect(uploadOf("a.txt").start).toHaveBeenCalledTimes(1);
  });

  test("with autoStart off, files stay queued until start()", () => {
    const uploader = createUploader({ endpoint, autoStart: false });

    uploader.addFiles([makeFile("a.txt"), makeFile("b.txt")]);

    expect(statuses(uploader)).toEqual({ "a.txt": "queued", "b.txt": "queued" });
    expect(tus.uploads).toHaveLength(0);
  });

  test("start(id) starts only that file", () => {
    const uploader = createUploader({ endpoint, autoStart: false });
    const { accepted } = uploader.addFiles([makeFile("a.txt"), makeFile("b.txt")]);

    uploader.start(accepted[1]?.id);

    expect(statuses(uploader)).toEqual({ "a.txt": "queued", "b.txt": "uploading" });
    expect(tus.uploads.map((upload) => upload.file.name)).toEqual(["b.txt"]);
  });

  test("start() starts all queued files", () => {
    const uploader = createUploader({ endpoint, autoStart: false });
    uploader.addFiles([makeFile("a.txt"), makeFile("b.txt")]);

    uploader.start();

    expect(statuses(uploader)).toEqual({ "a.txt": "uploading", "b.txt": "uploading" });
  });

  test("start() ignores unknown ids and files that are not queued", () => {
    const uploader = createUploader({ endpoint });
    const { accepted } = uploader.addFiles([makeFile("a.txt"), makeFile("b.txt")]);
    succeed("b.txt");

    uploader.start("no-such-id");
    uploader.start(accepted[0]?.id);
    uploader.start(accepted[1]?.id);
    uploader.start();

    expect(tus.uploads).toHaveLength(2);
    expect(statuses(uploader)).toEqual({ "a.txt": "uploading", "b.txt": "complete" });
  });
});

describe("tus options", () => {
  test("uses the defaults", () => {
    createUploader({ endpoint }).addFiles([makeFile("a.txt", "text/plain")]);

    expect(uploadOf("a.txt").options).toMatchObject({
      endpoint,
      chunkSize: 5 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000, 10000, 20000],
      headers: {},
      metadata: { filename: "a.txt", filetype: "text/plain" },
    });
  });

  test("passes chunkSize and retryDelays on", () => {
    createUploader({ endpoint, chunkSize: 1024, retryDelays: [0, 50] }).addFiles([
      makeFile("a.txt"),
    ]);

    expect(uploadOf("a.txt").options).toMatchObject({ chunkSize: 1024, retryDelays: [0, 50] });
  });

  test("sends a metadata object along with filename and filetype", () => {
    createUploader({ endpoint, metadata: { album: "summer" } }).addFiles([
      makeFile("a.png", "image/png"),
    ]);

    expect(uploadOf("a.png").options.metadata).toEqual({
      album: "summer",
      filename: "a.png",
      filetype: "image/png",
    });
  });

  test("calls a metadata function with each file", () => {
    const metadata = vi.fn((file: File) => ({ label: file.name.toUpperCase() }));
    const files = [makeFile("a.txt", "text/plain"), makeFile("b.txt", "text/plain")];

    createUploader({ endpoint, metadata }).addFiles(files);

    expect(metadata.mock.calls.map(([file]) => file)).toEqual(files);
    expect(uploadOf("b.txt").options.metadata).toEqual({
      label: "B.TXT",
      filename: "b.txt",
      filetype: "text/plain",
    });
  });

  test("filename and filetype can't be overridden", () => {
    createUploader({ endpoint, metadata: { filename: "evil.exe", filetype: "x/y" } }).addFiles([
      makeFile("a.png", "image/png"),
    ]);

    expect(uploadOf("a.png").options.metadata).toEqual({
      filename: "a.png",
      filetype: "image/png",
    });
  });

  test("filetype is left out when the file has no type", () => {
    createUploader({ endpoint, metadata: { filetype: "x/y" } }).addFiles([makeFile("notes")]);

    expect(uploadOf("notes").options.metadata).toEqual({ filename: "notes" });
  });

  test("sends a headers object", () => {
    createUploader({ endpoint, headers: { Authorization: "Bearer abc" } }).addFiles([
      makeFile("a.txt"),
    ]);

    expect(uploadOf("a.txt").options.headers).toEqual({ Authorization: "Bearer abc" });
  });

  test("calls a headers function before every request", async () => {
    let token = 0;
    const headers = vi.fn(async () => ({ Authorization: `Bearer ${++token}` }));
    createUploader({ endpoint, headers }).addFiles([makeFile("a.txt")]);
    const request = { setHeader: vi.fn() };

    await uploadOf("a.txt").options.onBeforeRequest?.(request as never);
    await uploadOf("a.txt").options.onBeforeRequest?.(request as never);

    expect(request.setHeader.mock.calls).toEqual([
      ["Authorization", "Bearer 1"],
      ["Authorization", "Bearer 2"],
    ]);
  });
});

describe("queue", () => {
  const names = ["1.txt", "2.txt", "3.txt", "4.txt", "5.txt"];
  const uploading = (uploader: ReturnType<typeof createUploader>) =>
    uploader
      .getState()
      .files.filter((file) => file.status === "uploading")
      .map((file) => file.name);

  test("uploads 3 files at once by default", () => {
    const uploader = createUploader({ endpoint });

    uploader.addFiles(names.map((name) => makeFile(name)));

    expect(uploading(uploader)).toEqual(["1.txt", "2.txt", "3.txt"]);
    expect(tus.uploads).toHaveLength(3);
  });

  test("never runs more than parallelUploads, and starts the next file when one finishes", () => {
    const uploader = createUploader({ endpoint, parallelUploads: 2 });
    let most = 0;
    uploader.subscribe(() => {
      most = Math.max(most, uploading(uploader).length);
    });

    uploader.addFiles(names.map((name) => makeFile(name)));
    expect(uploading(uploader)).toEqual(["1.txt", "2.txt"]);

    succeed("2.txt");
    expect(uploading(uploader)).toEqual(["1.txt", "3.txt"]);

    succeed("1.txt");
    succeed("3.txt");
    expect(uploading(uploader)).toEqual(["4.txt", "5.txt"]);

    succeed("4.txt");
    succeed("5.txt");
    expect(uploading(uploader)).toEqual([]);
    expect(Object.values(statuses(uploader))).toEqual(Array(5).fill("complete"));
    expect(most).toBe(2);
    expect(tus.uploads.map((upload) => upload.file.name)).toEqual(names);
  });

  test("a failed upload frees its slot too", () => {
    const uploader = createUploader({ endpoint, parallelUploads: 1 });
    uploader.addFiles([makeFile("1.txt"), makeFile("2.txt")]);

    uploadOf("1.txt").options.onError?.(serverError(415, "File type not allowed\n"));

    expect(statuses(uploader)).toEqual({ "1.txt": "error", "2.txt": "uploading" });
  });

  test("files added later join the same queue", () => {
    const uploader = createUploader({ endpoint, parallelUploads: 1 });
    uploader.addFiles([makeFile("1.txt")]);
    uploader.addFiles([makeFile("2.txt")]);
    expect(uploading(uploader)).toEqual(["1.txt"]);

    succeed("1.txt");

    expect(uploading(uploader)).toEqual(["2.txt"]);
  });

  test("start(id) waits for a free slot", () => {
    const uploader = createUploader({ endpoint, parallelUploads: 1, autoStart: false });
    const { accepted } = uploader.addFiles([makeFile("1.txt"), makeFile("2.txt"), makeFile("3.txt")]);

    uploader.start(accepted[0]?.id);
    uploader.start(accepted[2]?.id);
    expect(statuses(uploader)).toEqual({ "1.txt": "uploading", "2.txt": "queued", "3.txt": "queued" });

    succeed("1.txt");

    // 3.txt was asked to start; 2.txt never was.
    expect(statuses(uploader)).toEqual({ "1.txt": "complete", "2.txt": "queued", "3.txt": "uploading" });
  });
});

describe("progress", () => {
  test("updates progress and bytesUploaded while uploading", () => {
    const uploader = createUploader({ endpoint });
    uploader.addFiles([makeFile("a.bin", "", 1000)]);
    const listener = vi.fn();
    uploader.subscribe(listener);
    const before = uploader.getState();

    uploadOf("a.bin").options.onProgress?.(250, 1000);

    expect(uploader.getState().files[0]).toMatchObject({
      status: "uploading",
      progress: 0.25,
      bytesUploaded: 250,
    });
    expect(uploader.getState()).not.toBe(before);
    expect(before.files[0]).toMatchObject({ progress: 0, bytesUploaded: 0 });
    expect(listener).toHaveBeenCalledTimes(1);

    uploadOf("a.bin").options.onProgress?.(1000, 1000);

    expect(uploader.getState().files[0]).toMatchObject({ progress: 1, bytesUploaded: 1000 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test("only the file that made progress gets a new state object", () => {
    const uploader = createUploader({ endpoint });
    uploader.addFiles([makeFile("a.bin", "", 1000), makeFile("b.bin", "", 1000)]);
    const [a, b] = uploader.getState().files;

    uploadOf("a.bin").options.onProgress?.(500, 1000);

    expect(uploader.getState().files[0]).not.toBe(a);
    expect(uploader.getState().files[1]).toBe(b);
  });
});

describe("success", () => {
  test("marks the file complete, saves the url and calls onComplete", () => {
    const onComplete = vi.fn();
    const uploader = createUploader({ endpoint, onComplete });
    uploader.addFiles([makeFile("a.bin", "", 1000)]);
    uploadOf("a.bin").options.onProgress?.(400, 1000);

    succeed("a.bin", `${endpoint}/abc123`);

    const file = uploader.getState().files[0];
    expect(file).toMatchObject({
      status: "complete",
      progress: 1,
      bytesUploaded: 1000,
      url: `${endpoint}/abc123`,
    });
    expect(file).not.toHaveProperty("error");
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(file);
  });
});

describe("errors", () => {
  test("a server rejection is an error that is not retryable", () => {
    const onError = vi.fn();
    const uploader = createUploader({ endpoint, onError });
    uploader.addFiles([makeFile("a.exe")]);
    const error = serverError(415, "File type not allowed\n");

    uploadOf("a.exe").options.onError?.(error);

    const file = uploader.getState().files[0];
    expect(file).toMatchObject({
      status: "error",
      error: "File type not allowed",
      retryable: false,
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(file, error);
  });

  test.each([413, 401, 500])("status %i without a body gets a fallback message", (status) => {
    const uploader = createUploader({ endpoint });
    uploader.addFiles([makeFile("a.bin")]);

    uploadOf("a.bin").options.onError?.(serverError(status, ""));

    expect(uploader.getState().files[0]).toMatchObject({
      status: "error",
      error: `Upload failed with status ${status}`,
      retryable: false,
    });
  });

  test("a request with no server response is retryable", () => {
    const onError = vi.fn();
    const uploader = createUploader({ endpoint, onError });
    uploader.addFiles([makeFile("a.bin", "", 1000)]);
    uploadOf("a.bin").options.onProgress?.(300, 1000);
    const error = networkError();

    uploadOf("a.bin").options.onError?.(error);

    const file = uploader.getState().files[0];
    expect(file).toMatchObject({
      status: "error",
      error: "Network error: the server could not be reached",
      retryable: true,
      // What was already sent is kept, so a later retry can show it.
      bytesUploaded: 300,
      progress: 0.3,
    });
    expect(onError).toHaveBeenCalledWith(file, error);
  });

  test("an upload that can't even start is an error that is not retryable", async () => {
    tus.startError = new Error("tus: no file or stream to upload provided");
    const onError = vi.fn();
    const uploader = createUploader({ endpoint, onError });

    uploader.addFiles([makeFile("a.bin")]);
    await flush();

    expect(uploader.getState().files[0]).toMatchObject({
      status: "error",
      error: "tus: no file or stream to upload provided",
      retryable: false,
    });
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe("removing files that are uploading", () => {
  test("remove stops the upload and starts the next file", () => {
    const uploader = createUploader({ endpoint, parallelUploads: 1 });
    const { accepted } = uploader.addFiles([makeFile("1.txt"), makeFile("2.txt")]);

    uploader.remove(accepted[0]?.id as string);

    expect(uploadOf("1.txt").abort).toHaveBeenCalledTimes(1);
    expect(statuses(uploader)).toEqual({ "2.txt": "uploading" });
  });

  test("late events from a removed upload are ignored", () => {
    const onComplete = vi.fn();
    const onError = vi.fn();
    const uploader = createUploader({ endpoint, onComplete, onError });
    const { accepted } = uploader.addFiles([makeFile("1.txt")]);
    uploader.remove(accepted[0]?.id as string);
    const listener = vi.fn();
    uploader.subscribe(listener);

    uploadOf("1.txt").options.onProgress?.(1, 2);
    uploadOf("1.txt").options.onError?.(networkError());
    succeed("1.txt");

    expect(uploader.getState().files).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  test("removing a waiting file keeps it from starting", () => {
    const uploader = createUploader({ endpoint, parallelUploads: 1 });
    const { accepted } = uploader.addFiles([makeFile("1.txt"), makeFile("2.txt"), makeFile("3.txt")]);

    uploader.remove(accepted[1]?.id as string);
    succeed("1.txt");

    expect(statuses(uploader)).toEqual({ "1.txt": "complete", "3.txt": "uploading" });
    expect(tus.uploads.map((upload) => upload.file.name)).toEqual(["1.txt", "3.txt"]);
  });

  test.each(["clear", "destroy"] as const)("%s stops every upload", (method) => {
    const uploader = createUploader({ endpoint, parallelUploads: 2 });
    uploader.addFiles([makeFile("1.txt"), makeFile("2.txt"), makeFile("3.txt")]);

    uploader[method]();

    expect(uploadOf("1.txt").abort).toHaveBeenCalledTimes(1);
    expect(uploadOf("2.txt").abort).toHaveBeenCalledTimes(1);
    // 3.txt was still waiting and must not start now.
    expect(tus.uploads).toHaveLength(2);
    expect(uploader.getState().files).toEqual([]);
  });
});
