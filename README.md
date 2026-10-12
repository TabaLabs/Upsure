<p align="center">
  <img src="https://raw.githubusercontent.com/TabaLabs/upsure/main/.github/assets/banner.png" alt="TabaLabs: useful open-source tools, made with care." width="800" />
</p>

# Upsure

[![CI](https://github.com/TabaLabs/upsure/actions/workflows/ci.yml/badge.svg)](https://github.com/TabaLabs/upsure/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Upsure is a small set of libraries for file uploads that continue where they stopped after a lost connection, a pause or a page reload.

> **Not on npm yet.** The packages work and are tested, but the first release has not been published. Until then, try Upsure from this repository with the [example app](./examples/react-node).

<!-- demo GIF -->

## Why Upsure

- **Uploads survive bad connections.** When the network drops, the upload continues from the last saved byte instead of starting over.
- **Five minutes to set up.** One function on the server, one component in React.
- **An open protocol, not a private one.** Upsure speaks [tus](https://tus.io), so the client works with any tus server and the server works with any tus client.
- **Usable by everyone.** The React component works with a keyboard and a screen reader, and can be translated.

## Packages

| Package | What it is |
| --- | --- |
| [`@tabalabs/upsure`](./packages/core) | The upload client. Plain TypeScript, no framework. |
| [`@tabalabs/upsure-react`](./packages/react) | A React hook and a drop-in component. |
| [`@tabalabs/upsure-node`](./packages/node) | The upload server for Node. |

## Features

**Client**

- Resumable uploads in chunks, with automatic retries
- Pause, resume, cancel and retry for each file
- Automatic retry when the browser comes back online
- Continues an unfinished upload after a page reload, when the same file is added again
- A queue that uploads a set number of files at the same time
- Checks before uploading: file type, file size, number of files, empty files
- Progress for each file, and image previews
- Extra headers (for auth tokens) and extra metadata for each upload

**React**

- `useUpsure` hook, safe with server rendering and React StrictMode
- `<Upsure />` component: drag and drop, click or keyboard to add files; a file list with progress bars, previews and buttons; messages for rejected files
- Screen reader announcements for finished, failed and rejected files
- Every text can be replaced, for example to translate it
- Optional stylesheet with CSS variables and automatic dark mode. The component also works without it.

**Server**

- One handler for plain `http` servers and Express
- Limits on file size and file type
- Content check for PNG, JPEG, GIF, WebP and PDF: a file whose content doesn't match its declared type is deleted and rejected
- An `authorize` function to reject requests
- A callback when an upload is complete
- Automatic cleanup of unfinished uploads (after 24 hours by default)

## Quick start

You need Node 20.19 or newer.

### 1. Install

```sh
npm install @tabalabs/upsure-react @tabalabs/upsure-node express
```

### 2. The server

Save this as `server.mjs` and run it with `node server.mjs`:

```js
import { createUpsureServer } from "@tabalabs/upsure-node";
import express from "express";

const upsure = createUpsureServer({ path: "/uploads", directory: "./uploads" });

const app = express();
app.all("/uploads", upsure.handle);
app.all("/uploads/:id", upsure.handle);

app.listen(3000, () => console.log("Uploads: http://localhost:3000/uploads"));
```

Uploaded files are written to the `uploads` folder. Mount the upload routes before any body parser, such as `express.json()`.

### 3. The React component

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

That's all: drop a file on the page and it uploads, with pause, resume and retry built in.

Limits set on the client are for quick feedback only. Set `maxFileSize` and `allowedTypes` on the server too; that is where they are enforced.

## How resume works

Upsure uses the open [tus](https://tus.io) protocol:

1. The client asks the server to create an upload and gets back a URL for it.
2. The client sends the file to that URL in pieces. The server writes each piece to disk as it arrives.
3. If the connection breaks, the client asks the server "how many bytes do you have?" and continues from exactly there.

Because the server keeps the answer, this also works after a page reload or a server restart. The browser remembers the upload URL in `localStorage`, so adding the same file again picks up the same upload.

## `@tabalabs/upsure`

The upload client, for any framework or none.

```js
import { createUploader } from "@tabalabs/upsure";

const uploader = createUploader({ endpoint: "/uploads" });

uploader.subscribe(() => {
  for (const file of uploader.getState().files) {
    console.log(file.name, file.status, `${Math.round(file.progress * 100)}%`);
  }
});

document.querySelector("input[type=file]").addEventListener("change", (event) => {
  uploader.addFiles(event.target.files);
});
```

### Options for `createUploader(options)`

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `endpoint` | `string` | required | URL of the upload endpoint, for example `"/uploads"`. |
| `maxFileSize` | `number` | no limit | Largest accepted file, in bytes. |
| `allowedTypes` | `string[]` | all types | Accepted types: MIME types (`"application/pdf"`), MIME wildcards (`"image/*"`) or extensions (`".zip"`). A file passes if it matches any of them. |
| `maxFiles` | `number` | no limit | Most files the uploader holds at once. |
| `chunkSize` | `number` | `5 * 1024 * 1024` | Size of each upload request, in bytes. |
| `parallelUploads` | `number` | `3` | How many files upload at the same time. |
| `autoStart` | `boolean` | `true` | Start uploading files as soon as they are added. |
| `retryDelays` | `number[]` | `[0, 1000, 3000, 5000, 10000, 20000]` | Delays in milliseconds between automatic retries of a failed request. |
| `headers` | object, or a function returning one (may be async) | none | Extra headers for every upload request, for example an auth token. A function is called before each request. |
| `metadata` | object, or a function of the `File` returning one | none | Extra metadata sent with each upload. `filename` and `filetype` are always sent. |
| `resumeAfterReload` | `boolean` | `true` | Remember unfinished uploads in `localStorage`, so adding the same file again after a reload continues it. |
| `previews` | `boolean` | `true` | Give image files a `previewUrl`. |
| `onComplete` | `(file) => void` | none | Called when a file has been fully uploaded. |
| `onError` | `(file, error) => void` | none | Called when an upload fails for good, after the automatic retries. |

### Methods

| Method | What it does |
| --- | --- |
| `addFiles(files)` | Checks the files (a `FileList` or an array of `File`) and queues the ones that pass. Returns `{ accepted, rejected }`. |
| `start(id?)` | Starts one queued file, or all queued files when no id is given. Only needed with `autoStart: false`. |
| `pause(id)` | Pauses a file that is uploading or queued. |
| `resume(id)` | Continues a paused file from where it stopped. |
| `retry(id)` | Tries a failed file again. |
| `cancel(id)` | Stops the upload, deletes it from the server and removes the file. |
| `remove(id)` | Removes one file from the list. An unfinished upload stays on the server until it expires. |
| `clear()` | Removes all files. |
| `getState()` | Returns `{ files }`. The same object is returned until something changes. |
| `subscribe(listener)` | Calls `listener` after every change. Returns a function that unsubscribes. |
| `destroy()` | Removes all files and listeners. Call it when you are done with the uploader. |

### File state

Each entry in `getState().files`:

| Field | Type | What it is |
| --- | --- | --- |
| `id` | `string` | Unique id, used in every method above. |
| `name` | `string` | File name. |
| `size` | `number` | Size in bytes. |
| `type` | `string` | MIME type as reported by the browser. Can be empty. |
| `status` | `"queued"`, `"uploading"`, `"paused"`, `"complete"` or `"error"` | Where the file is in its upload. |
| `progress` | `number` | From 0 to 1. |
| `bytesUploaded` | `number` | Bytes sent so far. |
| `previewUrl` | `string`, optional | Object URL of an image file. |
| `url` | `string`, optional | URL of the upload on the server, once it is complete. |
| `error` | `string`, optional | Why the upload failed, when `status` is `"error"`. |
| `retryable` | `boolean`, optional | When `status` is `"error"`: `true` if the server never answered (a network problem), `false` if the server rejected the upload. |

A rejected file from `addFiles` has the form `{ file, reason }`, where `reason` is `"type"`, `"size"`, `"too-many-files"` or `"empty"`.

## `@tabalabs/upsure-react`

`react` 18 or newer is a peer dependency.

### `<Upsure />`

The component takes every option of `createUploader` above, plus:

| Prop | Type | Default | What it does |
| --- | --- | --- | --- |
| `onRejected` | `(rejected) => void` | none | Called with the files that were not accepted, each as `{ file, reason }`. |
| `className` | `string` | none | Extra class name for the root element. |
| `disabled` | `boolean` | `false` | Stops new files from being added. Files already in the list keep working. |
| `multiple` | `boolean` | `true` | Allow choosing several files at once. |
| `labels` | object | English texts | Replaces any of the component's texts. See [labels.ts](./packages/react/src/labels.ts) for every key. |

Options are read once, when the component mounts. Only the callbacks (`onComplete`, `onError`, `onRejected`) follow later renders.

To translate the component, pass the texts you want to change:

```jsx
<Upsure
  endpoint="/uploads"
  labels={{
    dropzone: "Dateien hierher ziehen oder klicken",
    pause: "Pause",
    pauseFile: (name) => `${name} pausieren`,
  }}
/>
```

### Styling

Import the stylesheet once:

```js
import "@tabalabs/upsure-react/styles.css";
```

Change its look with CSS variables, set on `.upsure` or any parent:

| Variable | Default (light) | What it colors |
| --- | --- | --- |
| `--upsure-accent` | `#7c4dff` | Progress bars, focus outlines, the drag-over state |
| `--upsure-radius` | `10px` | Corner radius |
| `--upsure-font` | the system font | Font family |
| `--upsure-bg` | `#ffffff` | Background of files and buttons |
| `--upsure-surface` | `#f6f6f9` | Background of the dropzone |
| `--upsure-border` | `#c9c9d4` | Borders |
| `--upsure-text` | `#1b1b22` | Text |
| `--upsure-muted` | `#5c5c6b` | Secondary text |
| `--upsure-danger` | `#b3261e` | Errors, Cancel and Remove |
| `--upsure-success` | `#1b6e3c` | Finished uploads |
| `--upsure-track` | `#e4e4ec` | Empty part of a progress bar |

Dark mode follows the system setting (`prefers-color-scheme`).

Without the stylesheet the component is still usable. Every element has a stable class name (`upsure-dropzone`, `upsure-file`, `upsure-progress`, `upsure-button` and so on), and each file has a `data-status` attribute, so you can style it yourself.

### `useUpsure(options)`

For your own interface. It takes the same options as `<Upsure />` except `className`, `disabled`, `multiple` and `labels`.

```jsx
import { useUpsure } from "@tabalabs/upsure-react";

export function Uploader() {
  const { files, addFiles, pause, resume, totalProgress, isUploading } = useUpsure({
    endpoint: "/uploads",
  });

  return (
    <div>
      <input type="file" multiple onChange={(event) => event.target.files && addFiles(event.target.files)} />
      {isUploading && <p>{Math.round(totalProgress * 100)}% uploaded</p>}
      <ul>
        {files.map((file) => (
          <li key={file.id}>
            {file.name}: {file.status}
            {file.status === "uploading" && <button onClick={() => pause(file.id)}>Pause</button>}
            {file.status === "paused" && <button onClick={() => resume(file.id)}>Resume</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

It returns:

| Value | What it is |
| --- | --- |
| `files` | The state of every file, as described under [File state](#file-state). |
| `addFiles`, `start`, `pause`, `resume`, `cancel`, `retry`, `remove`, `clear` | The uploader's methods. |
| `totalProgress` | Progress across all files, from 0 to 1, weighted by file size. |
| `isUploading` | `true` while at least one file is uploading. |
| `uploader` | The uploader itself. It is `null` on the server and during the first render. |

## `@tabalabs/upsure-node`

### Options for `createUpsureServer(options)`

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `path` | `string` | required | URL path the upload endpoint is served from, for example `"/uploads"`. |
| `directory` | `string` | required | Folder the uploaded files are written to. Created if it doesn't exist. |
| `maxFileSize` | `number` | no limit | Largest accepted file, in bytes. Bigger uploads are rejected with status 413. |
| `allowedTypes` | `string[]` | all types | Accepted types, in the same form as on the client. Checked against the file name and type the client sends. Others are rejected with status 415. |
| `expireAfter` | `number` | 24 hours | How long an unfinished upload is kept, in milliseconds. `0` keeps them forever. |
| `authorize` | `(request) => boolean` (may be async) | none | Called for every upload request with a web-standard `Request`. Return `false` to reject it with status 401. |
| `onUploadComplete` | `(file) => void` (may be async) | none | Called once when an upload has been fully received. |

`onUploadComplete` receives:

| Field | What it is |
| --- | --- |
| `id` | Upload id. Also the name of the stored file inside `directory`. |
| `name` | Original file name, cleaned of folders and unsafe characters. |
| `type` | MIME type the client declared. |
| `size` | Size in bytes. |
| `path` | Absolute path of the stored file. |
| `metadata` | All metadata the client sent. |

`createUpsureServer` returns:

| Value | What it is |
| --- | --- |
| `handle(req, res)` | The request handler, for plain `http` servers and Express. |
| `close()` | Stops the cleanup timer. Call it when shutting down. |
| `tus` | The underlying [tus server](https://github.com/tus/tus-node-server), for anything Upsure doesn't cover. |

A server with limits, auth and a callback:

```js
import { createUpsureServer } from "@tabalabs/upsure-node";

const upsure = createUpsureServer({
  path: "/uploads",
  directory: "./uploads",
  maxFileSize: 50 * 1024 * 1024,
  allowedTypes: ["image/*", "application/pdf"],
  authorize: (request) => request.headers.get("authorization") === "Bearer my-secret-token",
  onUploadComplete: (file) => console.log(`${file.name} (${file.size} bytes) saved to ${file.path}`),
});
```

Files are stored under their upload id, without an extension. Use `onUploadComplete` to move or rename them.

Without Express, pass the handler to Node's own server:

```js
import { createServer } from "node:http";
import { createUpsureServer } from "@tabalabs/upsure-node";

const upsure = createUpsureServer({ path: "/uploads", directory: "./uploads" });

createServer(upsure.handle).listen(3000);
```

## Example app

[examples/react-node](./examples/react-node) is a complete app: an Express server and a Vite + React page. From the repository root:

```sh
pnpm install
pnpm example
```

Then open <http://localhost:5173>. Its [README](./examples/react-node/README.md) shows how to test pause, going offline, reloading and restarting the server by hand.

## Contributing

Bug reports and pull requests are welcome. [CONTRIBUTING.md](./CONTRIBUTING.md) explains how to set up the repository, run the tests, and name branches and commits.

## License

[MIT](./LICENSE) © TabaLabs
