import { describe, expect, test } from "vitest";
import { createUploader } from "../src/index";
import { makeFile, makeFileList } from "./helpers";

const endpoint = "/uploads";

/** Adds one file and returns the rejection reason, or null when it was accepted. */
function reasonFor(options: Parameters<typeof createUploader>[0], file: File) {
  const { rejected } = createUploader(options).addFiles([file]);
  return rejected[0]?.reason ?? null;
}

describe("createUploader", () => {
  test("requires an endpoint", () => {
    expect(() => createUploader({} as never)).toThrow(/endpoint/);
    expect(() => createUploader({ endpoint: "" })).toThrow(/endpoint/);
  });

  test("accepts any non-empty file when no limits are set", () => {
    const { accepted, rejected } = createUploader({ endpoint }).addFiles([
      makeFile("a.exe", "application/x-msdownload"),
      makeFile("no-type"),
    ]);

    expect(accepted).toHaveLength(2);
    expect(rejected).toEqual([]);
  });
});

describe("addFiles input", () => {
  test("accepts an array of File", () => {
    const { accepted } = createUploader({ endpoint }).addFiles([makeFile("a.txt", "text/plain")]);

    expect(accepted).toHaveLength(1);
  });

  test("accepts a FileList", () => {
    const list = makeFileList([makeFile("a.txt", "text/plain"), makeFile("b.txt", "text/plain")]);
    expect(list).toBeInstanceOf(FileList);

    const { accepted } = createUploader({ endpoint }).addFiles(list);

    expect(accepted.map((file) => file.name)).toEqual(["a.txt", "b.txt"]);
  });

  test("returns the rejected file itself with its reason", () => {
    const empty = makeFile("empty.txt", "text/plain", 0);

    const { accepted, rejected } = createUploader({ endpoint }).addFiles([empty]);

    expect(accepted).toEqual([]);
    expect(rejected).toEqual([{ file: empty, reason: "empty" }]);
    expect(rejected[0]?.file).toBe(empty);
  });

  test("sorts a mixed batch into accepted and rejected", () => {
    const uploader = createUploader({ endpoint, allowedTypes: ["image/*"], maxFileSize: 1000 });

    const { accepted, rejected } = uploader.addFiles([
      makeFile("ok.png", "image/png", 500),
      makeFile("doc.pdf", "application/pdf", 500),
      makeFile("big.png", "image/png", 1001),
      makeFile("empty.png", "image/png", 0),
      makeFile("ok.jpg", "image/jpeg", 1000),
    ]);

    expect(accepted.map((file) => file.name)).toEqual(["ok.png", "ok.jpg"]);
    expect(rejected.map(({ file, reason }) => [file.name, reason])).toEqual([
      ["doc.pdf", "type"],
      ["big.png", "size"],
      ["empty.png", "empty"],
    ]);
  });
});

describe("empty files", () => {
  test("a zero-byte file is rejected as empty", () => {
    expect(reasonFor({ endpoint }, makeFile("empty.txt", "text/plain", 0))).toBe("empty");
  });

  test("empty wins over the other reasons", () => {
    const options = { endpoint, allowedTypes: ["image/*"], maxFiles: 0 };

    expect(reasonFor(options, makeFile("empty.txt", "text/plain", 0))).toBe("empty");
  });
});

describe("allowedTypes", () => {
  const options = { endpoint, allowedTypes: ["image/*", "application/pdf", ".zip"] };

  test.each([
    ["a MIME wildcard", makeFile("photo.png", "image/png")],
    ["an exact MIME type", makeFile("report", "application/pdf")],
    ["an extension", makeFile("archive.zip", "application/octet-stream")],
    ["an uppercase extension", makeFile("ARCHIVE.ZIP", "application/octet-stream")],
    ["an uppercase MIME type", makeFile("photo", "IMAGE/PNG")],
    ["an extension when the file has no type", makeFile("archive.zip")],
  ])("accepts a file matching %s", (_label, file) => {
    expect(reasonFor(options, file)).toBeNull();
  });

  test.each([
    ["another type", makeFile("notes.txt", "text/plain")],
    ["a file with no type and no matching extension", makeFile("notes")],
    ["a file with no type whose name looks like a MIME type", makeFile("image/png")],
    ["a type that only shares the wildcard prefix", makeFile("a.bin", "imagex/png")],
    ["a name that merely contains the extension", makeFile("archive.zip.exe")],
    ["a name that is only the extension", makeFile(".zip")],
  ])("rejects %s", (_label, file) => {
    expect(reasonFor(options, file)).toBe("type");
  });

  test("patterns are case-insensitive and trimmed", () => {
    const loose = { endpoint, allowedTypes: [" IMAGE/* ", ".ZIP"] };

    expect(reasonFor(loose, makeFile("photo.png", "image/png"))).toBeNull();
    expect(reasonFor(loose, makeFile("archive.zip"))).toBeNull();
  });

  test("an empty list rejects everything", () => {
    expect(reasonFor({ endpoint, allowedTypes: [] }, makeFile("a.png", "image/png"))).toBe("type");
  });
});

describe("maxFileSize", () => {
  const options = { endpoint, maxFileSize: 1000 };

  test("accepts a file exactly at the limit", () => {
    expect(reasonFor(options, makeFile("a.bin", "", 1000))).toBeNull();
  });

  test("rejects a file one byte over the limit", () => {
    expect(reasonFor(options, makeFile("a.bin", "", 1001))).toBe("size");
  });

  test("type is reported before size", () => {
    const both = { endpoint, maxFileSize: 1000, allowedTypes: ["image/*"] };

    expect(reasonFor(both, makeFile("big.txt", "text/plain", 5000))).toBe("type");
  });
});

describe("maxFiles", () => {
  test("rejects the files over the limit within one call", () => {
    const uploader = createUploader({ endpoint, maxFiles: 2 });

    const { accepted, rejected } = uploader.addFiles([
      makeFile("1.txt"),
      makeFile("2.txt"),
      makeFile("3.txt"),
    ]);

    expect(accepted.map((file) => file.name)).toEqual(["1.txt", "2.txt"]);
    expect(rejected.map(({ file, reason }) => [file.name, reason])).toEqual([
      ["3.txt", "too-many-files"],
    ]);
  });

  test("counts files across several addFiles calls", () => {
    const uploader = createUploader({ endpoint, maxFiles: 3 });

    expect(uploader.addFiles([makeFile("1.txt"), makeFile("2.txt")]).accepted).toHaveLength(2);
    const second = uploader.addFiles([makeFile("3.txt"), makeFile("4.txt")]);
    const third = uploader.addFiles([makeFile("5.txt")]);

    expect(second.accepted.map((file) => file.name)).toEqual(["3.txt"]);
    expect(second.rejected[0]?.reason).toBe("too-many-files");
    expect(third.rejected[0]?.reason).toBe("too-many-files");
    expect(uploader.getState().files).toHaveLength(3);
  });

  test("files rejected for another reason don't use up a slot", () => {
    const uploader = createUploader({ endpoint, maxFiles: 2, allowedTypes: [".txt"] });

    const { accepted } = uploader.addFiles([
      makeFile("a.exe"),
      makeFile("empty.txt", "", 0),
      makeFile("1.txt"),
      makeFile("2.txt"),
    ]);

    expect(accepted.map((file) => file.name)).toEqual(["1.txt", "2.txt"]);
  });

  test("removing a file frees a slot", () => {
    const uploader = createUploader({ endpoint, maxFiles: 1 });
    const [first] = uploader.addFiles([makeFile("1.txt")]).accepted;
    expect(uploader.addFiles([makeFile("2.txt")]).rejected[0]?.reason).toBe("too-many-files");

    uploader.remove(first?.id as string);

    expect(uploader.addFiles([makeFile("2.txt")]).accepted).toHaveLength(1);
  });
});
