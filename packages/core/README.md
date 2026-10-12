<p align="center">
  <img src="https://raw.githubusercontent.com/TabaLabs/upsure/main/.github/assets/banner.png" alt="TabaLabs: useful open-source tools, made with care." width="800" />
</p>

# @tabalabs/upsure

The upload client of [Upsure](https://github.com/TabaLabs/upsure): file uploads that continue where they stopped after a lost connection, a pause or a page reload. Plain TypeScript, no framework.

It speaks the open [tus](https://tus.io) protocol, so it works with [`@tabalabs/upsure-node`](https://github.com/TabaLabs/upsure/tree/main/packages/node) or any other tus server.

Using React? [`@tabalabs/upsure-react`](https://github.com/TabaLabs/upsure/tree/main/packages/react) has a hook and a ready-made component.

## Install

```sh
npm install @tabalabs/upsure
```

## Example

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

Files start uploading as soon as they are added. Each one can be controlled by its id with `pause`, `resume`, `retry`, `cancel` and `remove`.

## Documentation

Every option, method and file field is described in the [main README](https://github.com/TabaLabs/upsure#tabalabsupsure).

## License

[MIT](https://github.com/TabaLabs/upsure/blob/main/LICENSE) © TabaLabs
