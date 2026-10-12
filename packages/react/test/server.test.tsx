// @vitest-environment node
import { renderToString } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { tus } from "../../core/test/fake-tus";
import { useUpsure } from "../src/index";

function Uploads({ onRender }: { onRender?: (result: ReturnType<typeof useUpsure>) => void }) {
  const upsure = useUpsure({ endpoint: "/uploads" });
  onRender?.(upsure);
  return (
    <p>
      {upsure.files.length} files, {Math.round(upsure.totalProgress * 100)}%,{" "}
      {upsure.isUploading ? "uploading" : "idle"}
    </p>
  );
}

test("this test really runs without a browser", () => {
  expect(typeof window).toBe("undefined");
  expect(typeof document).toBe("undefined");
});

test("renderToString doesn't crash and renders the empty state", () => {
  const html = renderToString(<Uploads />);

  expect(html.replace(/<!-- -->/g, "")).toBe("<p>0 files, 0%, idle</p>");
});

test("on the server there is no uploader, and the actions are safe to call", () => {
  const onRender = vi.fn();

  renderToString(<Uploads onRender={onRender} />);

  const result = onRender.mock.calls[0]?.[0] as ReturnType<typeof useUpsure>;
  expect(result.uploader).toBeNull();
  expect(result.files).toEqual([]);
  expect(result.addFiles([])).toEqual({ accepted: [], rejected: [] });
  expect(() => {
    result.start();
    result.pause("x");
    result.resume("x");
    result.cancel("x");
    result.retry("x");
    result.remove("x");
    result.clear();
  }).not.toThrow();
  expect(tus.uploads).toHaveLength(0);
});
