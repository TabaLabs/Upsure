<p align="center">
  <img src="https://raw.githubusercontent.com/TabaLabs/upsure/main/.github/assets/banner.png" alt="TabaLabs: useful open-source tools, made with care." width="800" />
</p>

# @tabalabs/upsure-react

The React package of [Upsure](https://github.com/TabaLabs/upsure): file uploads that continue where they stopped after a lost connection, a pause or a page reload.

It has a drop-in `<Upsure />` component and a `useUpsure` hook for building your own interface. It works with [`@tabalabs/upsure-node`](https://github.com/TabaLabs/upsure/tree/main/packages/node) or any other [tus](https://tus.io) server.

## Install

```sh
npm install @tabalabs/upsure-react
```

`react` 18 or newer is a peer dependency.

## Example

```jsx
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

## Documentation

Props, the `useUpsure` hook, translation and styling are described in the [main README](https://github.com/TabaLabs/upsure#tabalabsupsure-react).

## License

[MIT](https://github.com/TabaLabs/upsure/blob/main/LICENSE) © TabaLabs
