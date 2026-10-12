# Upsure example: React + Node

A small app that shows the Upsure packages working together:

- **Backend:** Express with `@tabalabs/upsure-node`, serving uploads at `/uploads` ([server.mjs](./server.mjs)).
- **Frontend:** Vite + React with the `<Upsure />` component and its stylesheet ([src/App.tsx](./src/App.tsx)).

It accepts images, PDFs and `.zip` files up to 2 GB. Uploaded files are saved in `examples/react-node/uploads`, which git ignores.

## Run it

Requires Node 20+ and [pnpm](https://pnpm.io). From the **repo root**:

```sh
pnpm install
pnpm example
```

`pnpm example` builds the packages, then starts both servers. Open <http://localhost:5173>.

Stop it with Ctrl+C.

| | Address |
| --- | --- |
| The page (Vite) | <http://localhost:5173> |
| The upload server (Express) | <http://127.0.0.1:3001/uploads> |

The browser only talks to Vite. Vite passes every `/uploads` request on to Express ([vite.config.js](./vite.config.js)), so there is no CORS to configure.

Each finished upload is logged in the terminal with its name and size.

## Test resume by hand

Use a file that takes a while to upload: a few hundred MB works well on a local machine. To slow it down, open the browser's developer tools, go to the **Network** tab and choose a throttling profile such as "Fast 4G".

**Pause and resume**

1. Add the file and wait until it shows some progress.
2. Click **Pause**, then **Resume**.
3. The progress continues from where it stopped instead of starting at 0%.

**Lose the connection**

1. Add the file and wait until it shows some progress.
2. In the developer tools **Network** tab, switch throttling to **Offline**.
3. The upload stops and the file shows "Failed: Network error: the server could not be reached".
4. Switch throttling back to what it was. The upload starts again by itself and continues from where it stopped.

Turning your Wi-Fi off does not interrupt this example: the page and the server are both on your own machine, so the upload never leaves it.

**Reload the page**

1. Add the file and wait until it shows some progress.
2. Reload the page. The list is empty again.
3. Add the same file again, from the same place on your disk. It continues from where it stopped instead of starting at 0%.

**Restart the server**

1. Add the file and wait until it shows some progress.
2. Stop the example with Ctrl+C and start it again with `pnpm example`.
3. Reload the page and add the same file again. It continues from where it stopped, because the partial upload is kept in the `uploads` folder.

## Smoke test

From the repo root:

```sh
pnpm test:e2e
```

It starts the example on its own ports, opens the page in a real browser, uploads a small image, and checks that it reaches "Uploaded" and that the file is in the `uploads` folder. The test file is deleted again afterwards.

It uses a browser that is already installed: a Chromium from an earlier Playwright install, otherwise Chrome, otherwise Edge. If none is found, install one with `npx playwright install chromium`.
