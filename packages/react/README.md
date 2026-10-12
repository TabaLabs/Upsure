<p align="center">
  <img src="https://raw.githubusercontent.com/TabaLabs/upsure/main/.github/assets/banner.png" alt="TabaLabs: useful open-source tools, made with care." width="800" />
</p>

# @tabalabs/upsure-react

[![npm](https://img.shields.io/npm/v/@tabalabs/upsure-react)](https://www.npmjs.com/package/@tabalabs/upsure-react)

The React package of [Upsure](https://github.com/TabaLabs/upsure): file uploads that continue where they stopped after a lost connection, a pause or a page reload.

It has a drop-in `<Upsure />` component and a `useUpsure` hook for building your own interface. It works with [`@tabalabs/upsure-node`](https://github.com/TabaLabs/upsure/tree/main/packages/node) or any other [tus](https://tus.io) server.

## Install

Install it in the folder of your React app:

```sh
npm install @tabalabs/upsure-react
```

`react` 18 or newer is a peer dependency. The types are included.

No React app yet? Create one with `npm create vite@latest upload-app -- --template react-ts`, then install the package inside `upload-app`.

## Example

Put this in `src/App.tsx`:

```tsx
import { Upsure } from "@tabalabs/upsure-react";
import "@tabalabs/upsure-react/styles.css";

export default function App() {
  return (
    <Upsure
      endpoint="http://localhost:3000/uploads"
      maxFileSize={50 * 1024 * 1024}
      allowedTypes={["image/*", "application/pdf"]}
      onComplete={(file) => console.log("Uploaded:", file.name, file.url)}
    />
  );
}
```

The component handles drag and drop, click and keyboard, and shows a file list with progress, previews and Pause, Resume, Cancel and Retry buttons. The stylesheet is optional.

`endpoint` is the address of your upload server. The [quick start](https://github.com/TabaLabs/upsure#quick-start) sets one up in a few lines.

## Documentation

Props, the `useUpsure` hook, translation and styling are described in the [main README](https://github.com/TabaLabs/upsure#tabalabsupsure-react).

## License

[MIT](https://github.com/TabaLabs/upsure/blob/main/LICENSE) © TabaLabs
