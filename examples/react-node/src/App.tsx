import { Upsure } from "@tabalabs/upsure-react";

const GB = 1024 * 1024 * 1024;

export function App() {
  return (
    <main className="page">
      <h1>Upsure example</h1>
      <p>
        Add an image, a PDF or a .zip. Then pause it, reload the page or go offline in the developer
        tools: the upload continues from where it stopped.
      </p>
      <Upsure
        endpoint="/uploads"
        maxFileSize={2 * GB}
        allowedTypes={["image/*", "application/pdf", ".zip"]}
      />
    </main>
  );
}
