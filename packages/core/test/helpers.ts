/**
 * Creates a File with the given name and type. `size` is faked, so tests can
 * use multi-gigabyte files without allocating them.
 */
export function makeFile(name: string, type = "", size = 1024): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

/** Builds a real FileList (jsdom has no constructor for one) from files. */
export function makeFileList(files: File[]): FileList {
  const list = Object.create(FileList.prototype) as Record<string | number, unknown>;
  files.forEach((file, index) => {
    list[index] = file;
  });
  Object.defineProperty(list, "length", { value: files.length });
  Object.defineProperty(list, "item", { value: (index: number) => files[index] ?? null });
  return list as unknown as FileList;
}
