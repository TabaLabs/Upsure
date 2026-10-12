<p align="center">
  <img src="https://raw.githubusercontent.com/TabaLabs/upsure/main/.github/assets/banner.png" alt="TabaLabs: useful open-source tools, made with care." width="800" />
</p>

# Upsure

[![CI](https://github.com/TabaLabs/upsure/actions/workflows/ci.yml/badge.svg)](https://github.com/TabaLabs/upsure/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![@tabalabs/upsure on npm](https://img.shields.io/npm/v/@tabalabs/upsure?label=%40tabalabs%2Fupsure)](https://www.npmjs.com/package/@tabalabs/upsure)
[![@tabalabs/upsure-react on npm](https://img.shields.io/npm/v/@tabalabs/upsure-react?label=%40tabalabs%2Fupsure-react)](https://www.npmjs.com/package/@tabalabs/upsure-react)
[![@tabalabs/upsure-node on npm](https://img.shields.io/npm/v/@tabalabs/upsure-node?label=%40tabalabs%2Fupsure-node)](https://www.npmjs.com/package/@tabalabs/upsure-node)

Upsure is a small set of libraries for file uploads that continue where they stopped after a lost connection, a pause or a page reload.

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
- A list of websites that are allowed to upload
- Content check for PNG, JPEG, GIF, WebP and PDF: a file whose content doesn't match its declared type is deleted and rejected
- An `authorize` function to reject requests
- A callback when an upload is complete
- Automatic cleanup of unfinished uploads (after 24 hours by default)

## Quick start

You need Node 20.19 or newer. The quick start makes two folders: one for the server and one for the React app.

### 1. The server

Make a folder for the server and install the server package there:

```sh
mkdir upload-server
cd upload-server
npm init -y
npm install @tabalabs/upsure-node express
```

Save this as `server.mjs` in that folder:

```js
import { createUpsureServer } from "@tabalabs/upsure-node";
import express from "express";

const upsure = createUpsureServer({
  path: "/uploads",
  directory: "./uploads",
  allowedOrigins: ["http://localhost:5173"],
});

const app = express();
app.all("/uploads", upsure.handle);
app.all("/uploads/:id", upsure.handle);

app.listen(3000, () => console.log("Uploads: http://localhost:3000/uploads"));
```

Start it:

```sh
node server.mjs
```

- **`allowedOrigins`** lists the websites whose pages may upload. `http://localhost:5173` is where the React app from step 2 runs. Without this option the server accepts uploads from pages on any website. It needs `@tabalabs/upsure-node` 0.2.0 or newer; older versions ignore it.
- **`directory`** is where files are written. `"./uploads"` is resolved from the folder you start the server from, not from the folder `server.mjs` is in. See [Where files are stored](#where-files-are-stored) for a fixed location.
- **Body parsers:** mount the upload routes before any body parser, such as `express.json()`.

### 2. The React app

In a second terminal, create a React app with [Vite](https://vite.dev) and install the React package in the app's folder:

```sh
npm create vite@latest upload-app -- --template react-ts
cd upload-app
npm install
npm install @tabalabs/upsure-react
```

Replace the contents of `src/App.tsx` with:

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

Start it:

```sh
npm run dev
```

Open <http://localhost:5173> and drop an image or a PDF on the page. It uploads, with pause, resume and retry built in, and the file appears in `upload-server/uploads`.

The two packages go in different places: `@tabalabs/upsure-react` in the app's folder, `@tabalabs/upsure-node` in the server's folder. If your app and server share one folder and one `package.json`, install both there.

Limits set on the client are for quick feedback only. Set `maxFileSize` and `allowedTypes` on the server too; that is where they are enforced.

### TypeScript

All three packages include their own types; there is nothing extra to install for them.

To write the server in TypeScript, use an ESM project (`"type": "module"` in the server's `package.json`), because the examples use `import`, and install Express's types with `npm install -D @types/express`.

Keep `skipLibCheck: true` in your `tsconfig.json`. With `skipLibCheck: false`, TypeScript reports errors that come from a dependency of the tus server (`srvx`), not from Upsure.

## Before production

The quick start is for trying Upsure on your own machine. Before real users upload real files, go through this list:

- [ ] **`allowedOrigins`:** list your site's real address, for example `["https://example.com"]`. Without it, pages on any website can upload to your server. This stops other websites, not other programs: a script can still send requests.
- [ ] **`authorize`:** check who is uploading. Send a token from the client with the `headers` option and check it here; return `false` to reject the request.
- [ ] **`maxFileSize`:** set a limit on the server. Without one, a single upload can fill your disk.
- [ ] **`allowedTypes`:** list the file types you accept. The type and name are sent by the client and can be faked; the content is only checked for PNG, JPEG, GIF, WebP and PDF.
- [ ] **HTTPS:** serve both the page and the upload endpoint over HTTPS. If a proxy in front of Node handles HTTPS, set `trustProxy: true`; see the note below.
- [ ] **Where files are stored:** use a fixed folder outside your code, with enough space, that the web server does not serve directly. See [Where files are stored](#where-files-are-stored).

**HTTPS behind a proxy.** The server builds the upload URL from the request it sees. Behind a proxy such as nginx that handles HTTPS, it sees plain `http`, and the browser then refuses to upload to an `http://` address from an `https://` page. Have the proxy send the `X-Forwarded-Proto` and `X-Forwarded-Host` headers, and tell the server to use them with `trustProxy`:

```js
import { createUpsureServer } from "@tabalabs/upsure-node";

const upsure = createUpsureServer({
  path: "/uploads",
  directory: "./uploads",
  trustProxy: true,
});
```

Only set `trustProxy` behind a proxy you control, because these headers can otherwise be set by anyone. It needs `@tabalabs/upsure-node` 0.2.0 or newer.

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
| `onError` | `(file, error) => void` | none | Called every time a file's status becomes `"error"`: at once when the server rejects the upload or the browser is offline, otherwise after the retries in `retryDelays` have run out. Called again if a later retry of the same file fails too. |

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
| `retryable` | `boolean`, optional | When `status` is `"error"`: `true` if the server never answered (a network problem), `false` if the server answered with an error. A file with `retryable: true` is retried by itself when the browser comes back online; one with `false` waits for `retry(id)`. |

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
| `allowedOrigins` | `string[]` | every website | Websites whose pages may upload, as origins like `"https://example.com"`. Browsers block pages from other sites. It does not stop programs other than browsers; use `authorize` for that. Needs version 0.2.0 or newer. |
| `trustProxy` | `boolean` | `false` | Set to `true` behind a reverse proxy such as nginx. Upload URLs then use the protocol and host from the proxy's `X-Forwarded-Proto` and `X-Forwarded-Host` headers, so they stay `https`. Needs version 0.2.0 or newer. |
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

A server with limits, an allowed website, auth and a callback:

```js
import { createUpsureServer } from "@tabalabs/upsure-node";

const upsure = createUpsureServer({
  path: "/uploads",
  directory: "./uploads",
  maxFileSize: 50 * 1024 * 1024,
  allowedTypes: ["image/*", "application/pdf"],
  allowedOrigins: ["https://example.com"],
  authorize: (request) => request.headers.get("authorization") === "Bearer my-secret-token",
  onUploadComplete: (file) => console.log(`${file.name} (${file.size} bytes) saved to ${file.path}`),
});
```

### Where files are stored

A relative `directory` such as `"./uploads"` is resolved from the folder you start the server from. Starting the same server from another folder writes to another place. For a fixed location, build the path from the file the server code is in:

```js
import path from "node:path";
import { createUpsureServer } from "@tabalabs/upsure-node";

const upsure = createUpsureServer({
  path: "/uploads",
  directory: path.resolve(import.meta.dirname, "uploads"),
});
```

Each upload is two files in that folder:

| File | What it holds |
| --- | --- |
| `<id>` | The content of the upload. It has no extension and grows while the upload is in progress. |
| `<id>.json` | Information about the upload: the original file name and type the client sent, the full size, and when it was created. |

Don't delete or move either file while an upload is in progress: the server needs both to continue it. Unfinished uploads are removed by the server itself once they are older than `expireAfter`.

The file on disk is named after the upload id, not after the original file. `onUploadComplete` gives you both the original name and the path:

```js
import { rename, rm } from "node:fs/promises";
import path from "node:path";
import { createUpsureServer } from "@tabalabs/upsure-node";

const finished = path.resolve(import.meta.dirname, "finished");

const upsure = createUpsureServer({
  path: "/uploads",
  directory: path.resolve(import.meta.dirname, "uploads"),
  async onUploadComplete(file) {
    console.log(`${file.name} is stored at ${file.path}`);

    // Optional: move the finished file somewhere else under its original name.
    await rename(file.path, path.join(finished, `${file.id}-${file.name}`));
    await rm(`${file.path}.json`);
  },
});
```

`file.name` is the original name with folders and unsafe characters removed. The example puts the id in front because two people can upload files with the same name. The `finished` folder must exist and be on the same disk as `directory`.

Finished uploads are never deleted by the server. If you don't move them, they stay in `directory` as `<id>` and `<id>.json`.

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
