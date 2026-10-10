import { open } from "node:fs/promises";

type Signature = (head: Buffer) => boolean;

const startsWith = (head: Buffer, bytes: number[] | string, offset = 0): boolean => {
  const expected = typeof bytes === "string" ? Buffer.from(bytes, "latin1") : Buffer.from(bytes);
  return head.subarray(offset, offset + expected.length).equals(expected);
};

/** File signatures ("magic bytes") of the types we can verify. */
const SIGNATURES: Record<string, Signature> = {
  png: (head) => startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpeg: (head) => startsWith(head, [0xff, 0xd8, 0xff]),
  gif: (head) => startsWith(head, "GIF87a") || startsWith(head, "GIF89a"),
  webp: (head) => startsWith(head, "RIFF") && startsWith(head, "WEBP", 8),
  pdf: (head) => startsWith(head, "%PDF-"),
};

const BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

const BY_EXTENSION: Record<string, string> = {
  png: "png",
  jpg: "jpeg",
  jpeg: "jpeg",
  gif: "gif",
  webp: "webp",
  pdf: "pdf",
};

/** Longest signature above: "RIFF" + 4 size bytes + "WEBP". */
const HEAD_LENGTH = 12;

/**
 * Checks that the first bytes of a stored file fit the type the client
 * declared. The `filetype` metadata decides; the extension of `filename` is
 * only used when no filetype was sent. Types we can't verify always pass.
 */
export async function contentMatchesDeclaredType(
  path: string,
  filetype: string | null | undefined,
  filename: string | null | undefined,
): Promise<boolean> {
  const mime = filetype?.split(";")[0]?.trim().toLowerCase();
  const extension = filename?.trim().toLowerCase().split(".").pop() ?? "";
  const kind = mime ? BY_MIME[mime] : BY_EXTENSION[extension];
  const signature = kind ? SIGNATURES[kind] : undefined;
  if (!signature) return true;

  const file = await open(path, "r");
  try {
    const { buffer, bytesRead } = await file.read(Buffer.alloc(HEAD_LENGTH), 0, HEAD_LENGTH, 0);
    return signature(buffer.subarray(0, bytesRead));
  } finally {
    await file.close();
  }
}
