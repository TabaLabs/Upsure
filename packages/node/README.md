<p align="center">
  <img src="https://raw.githubusercontent.com/TabaLabs/upsure/main/.github/assets/banner.png" alt="TabaLabs: useful open-source tools, made with care." width="800" />
</p>

# @tabalabs/upsure-node

[![npm](https://img.shields.io/npm/v/@tabalabs/upsure-node)](https://www.npmjs.com/package/@tabalabs/upsure-node)

The Node server of [Upsure](https://github.com/TabaLabs/upsure): it receives file uploads that continue where they stopped after a lost connection, a pause or a page reload.

It speaks the open [tus](https://tus.io) protocol, so it works with [`@tabalabs/upsure`](https://github.com/TabaLabs/upsure/tree/main/packages/core), [`@tabalabs/upsure-react`](https://github.com/TabaLabs/upsure/tree/main/packages/react) or any other tus client.

## Install

Install it in the folder of your server:

```sh
npm install @tabalabs/upsure-node
```

Requires Node 20.19 or newer. The types are included.

## Example

With Express (`npm install express`):

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

Save it as `server.mjs` and start it with `node server.mjs`. Mount the upload routes before any body parser, such as `express.json()`.

- **`allowedOrigins`** lists the websites whose pages may upload. Without it, the server accepts uploads from pages on any website.
- **`directory`** is resolved from the folder you start the server from.
- Each upload is stored as two files: `<id>` (the content) and `<id>.json` (the original name, type and size). Don't delete them while an upload is in progress.

Before real users upload, read the [Before production](https://github.com/TabaLabs/upsure#before-production) checklist.

Without Express:

```js
import { createServer } from "node:http";
import { createUpsureServer } from "@tabalabs/upsure-node";

const upsure = createUpsureServer({ path: "/uploads", directory: "./uploads" });

createServer(upsure.handle).listen(3000);
```

## Documentation

File size and type limits, the content check, `authorize`, `onUploadComplete`, where files are stored and cleanup of unfinished uploads are described in the [main README](https://github.com/TabaLabs/upsure#tabalabsupsure-node).

## License

[MIT](https://github.com/TabaLabs/upsure/blob/main/LICENSE) © TabaLabs
