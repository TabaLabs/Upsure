import { describe, expect, test, vi } from "vitest";
import { createUploader } from "../src/index";
import { makeFile } from "./helpers";

const endpoint = "/uploads";

describe("file state", () => {
  test("an accepted file starts queued with zero progress", () => {
    const uploader = createUploader({ endpoint });

    const { accepted } = uploader.addFiles([makeFile("photo.png", "image/png", 2048)]);

    expect(accepted).toEqual([
      {
        id: expect.any(String),
        name: "photo.png",
        size: 2048,
        type: "image/png",
        status: "queued",
        progress: 0,
        bytesUploaded: 0,
      },
    ]);
    expect(uploader.getState().files).toEqual(accepted);
  });

  test("a file with no type keeps an empty type", () => {
    const { accepted } = createUploader({ endpoint }).addFiles([makeFile("notes")]);

    expect(accepted[0]?.type).toBe("");
  });

  test("every file gets a unique id, even the same file added twice", () => {
    const uploader = createUploader({ endpoint });
    const other = createUploader({ endpoint });
    const file = makeFile("a.txt");

    uploader.addFiles([file, file]);
    uploader.addFiles([file]);
    other.addFiles([file]);

    const ids = [...uploader.getState().files, ...other.getState().files].map((f) => f.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });

  test("files are kept in the order they were added", () => {
    const uploader = createUploader({ endpoint });

    uploader.addFiles([makeFile("1.txt"), makeFile("2.txt")]);
    uploader.addFiles([makeFile("3.txt")]);

    expect(uploader.getState().files.map((file) => file.name)).toEqual([
      "1.txt",
      "2.txt",
      "3.txt",
    ]);
  });
});

describe("getState", () => {
  test("starts empty", () => {
    expect(createUploader({ endpoint }).getState()).toEqual({ files: [] });
  });

  test("returns the same object while nothing changes", () => {
    const uploader = createUploader({ endpoint, allowedTypes: [".txt"] });
    uploader.addFiles([makeFile("1.txt")]);
    const before = uploader.getState();

    uploader.getState();
    uploader.addFiles([makeFile("a.exe")]); // rejected
    uploader.addFiles([]);
    uploader.remove("no-such-id");
    const unsubscribe = uploader.subscribe(() => {});
    unsubscribe();

    expect(uploader.getState()).toBe(before);
  });

  test("returns a new object after every change, without mutating the old one", () => {
    const uploader = createUploader({ endpoint });
    const empty = uploader.getState();

    const [file] = uploader.addFiles([makeFile("1.txt")]).accepted;
    const afterAdd = uploader.getState();
    uploader.remove(file?.id as string);
    const afterRemove = uploader.getState();

    expect(afterAdd).not.toBe(empty);
    expect(afterAdd.files).not.toBe(empty.files);
    expect(afterRemove).not.toBe(afterAdd);
    expect(empty.files).toEqual([]);
    expect(afterAdd.files).toHaveLength(1);
    expect(afterRemove.files).toEqual([]);
  });
});

describe("subscribe", () => {
  test("calls listeners after every change, with the new state already in place", () => {
    const uploader = createUploader({ endpoint });
    const seen: number[] = [];
    uploader.subscribe(() => seen.push(uploader.getState().files.length));

    const { accepted } = uploader.addFiles([makeFile("1.txt"), makeFile("2.txt")]);
    uploader.remove(accepted[0]?.id as string);
    uploader.addFiles([makeFile("3.txt")]);
    uploader.clear();

    expect(seen).toEqual([2, 1, 2, 0]);
  });

  test("doesn't call listeners when nothing changed", () => {
    const uploader = createUploader({ endpoint, maxFiles: 0 });
    const listener = vi.fn();
    uploader.subscribe(listener);

    uploader.addFiles([makeFile("1.txt")]); // rejected
    uploader.addFiles([]);
    uploader.remove("no-such-id");
    uploader.clear();

    expect(listener).not.toHaveBeenCalled();
  });

  test("calls every listener", () => {
    const uploader = createUploader({ endpoint });
    const first = vi.fn();
    const second = vi.fn();
    uploader.subscribe(first);
    uploader.subscribe(second);

    uploader.addFiles([makeFile("1.txt")]);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  test("the returned function unsubscribes only that listener", () => {
    const uploader = createUploader({ endpoint });
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = uploader.subscribe(first);
    uploader.subscribe(second);

    unsubscribe();
    unsubscribe();
    uploader.addFiles([makeFile("1.txt")]);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  test("a listener can unsubscribe itself while being called", () => {
    const uploader = createUploader({ endpoint });
    const second = vi.fn();
    const unsubscribe = uploader.subscribe(() => unsubscribe());
    uploader.subscribe(second);

    uploader.addFiles([makeFile("1.txt")]);

    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("remove, clear and destroy", () => {
  test("remove takes out only the given file", () => {
    const uploader = createUploader({ endpoint });
    const { accepted } = uploader.addFiles([makeFile("1.txt"), makeFile("2.txt")]);

    uploader.remove(accepted[0]?.id as string);

    expect(uploader.getState().files).toEqual([accepted[1]]);
  });

  test("remove ignores an unknown id", () => {
    const uploader = createUploader({ endpoint });
    uploader.addFiles([makeFile("1.txt")]);

    uploader.remove("no-such-id");

    expect(uploader.getState().files).toHaveLength(1);
  });

  test("clear removes all files", () => {
    const uploader = createUploader({ endpoint });
    uploader.addFiles([makeFile("1.txt"), makeFile("2.txt")]);

    uploader.clear();

    expect(uploader.getState()).toEqual({ files: [] });
  });

  test("destroy removes all files and stops calling listeners", () => {
    const uploader = createUploader({ endpoint });
    const listener = vi.fn();
    uploader.addFiles([makeFile("1.txt")]);
    uploader.subscribe(listener);

    uploader.destroy();
    const afterDestroy = uploader.getState();
    uploader.addFiles([makeFile("2.txt")]);

    expect(afterDestroy).toEqual({ files: [] });
    expect(listener).not.toHaveBeenCalled();
  });
});
