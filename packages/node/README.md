<p align="center">
  <img src="https://raw.githubusercontent.com/TabaLabs/upsure/main/.github/assets/banner.png" alt="TabaLabs: useful open-source tools, made with care." width="800" />
</p>

# @tabalabs/upsure-node

The Node server of [Upsure](https://github.com/TabaLabs/upsure): it receives file uploads that continue where they stopped after a lost connection, a pause or a page reload.

It speaks the open [tus](https://tus.io) protocol, so it works with [`@tabalabs/upsure`](https://github.com/TabaLabs/upsure/tree/main/packages/core), [`@tabalabs/upsure-react`](https://github.com/TabaLabs/upsure/tree/main/packages/react) or any other tus client.

## Install

```sh
npm install @tabalabs/upsure-node
```

Requires Node 20.19 or newer.

## Example

With Express (`npm install express`):

```js
import { createUpsureServer } from "@tabalabs/upsure-node";
import express from "express";

const upsure = createUpsureServer({ path: "/uploads", directory: "./uploads" });

const app = express();
app.all("/uploads", upsure.handle);
app.all("/uploads/:id", upsure.handle);

app.listen(3000, () => console.log("Uploads: http://localhost:3000/uploads"));
```

Mount the upload routes before any body parser, such as `express.json()`.

Without Express:

```js
import { createServer } from "node:http";
import { createUpsureServer } from "@tabalabs/upsure-node";

const upsure = createUpsureServer({ path: "/uploads", directory: "./uploads" });

createServer(upsure.handle).listen(3000);
```

## Documentation

File size and type limits, the content check, `authorize`, `onUploadComplete` and cleanup of unfinished uploads are described in the [main README](https://github.com/TabaLabs/upsure#tabalabsupsure-node).

## License

[MIT](https://github.com/TabaLabs/upsure/blob/main/LICENSE) © TabaLabs
