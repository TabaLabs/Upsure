# Contributing to Upsure

Thanks for helping. This page covers how to set the project up, how to run the tests, and the rules for branches, commits and pull requests.

## Set up

You need:

- **Node 20.19 or newer**
- **pnpm 10.34.6.** The version is pinned in `package.json`. With [Corepack](https://nodejs.org/api/corepack.html), which ships with Node, run `corepack enable` once and the right version is used automatically.

Then:

```sh
git clone https://github.com/TabaLabs/upsure.git
cd upsure
pnpm install
pnpm build
```

Run `pnpm build` before the other commands: the packages use each other's built output.

## Project layout

| Folder | What it is |
| --- | --- |
| `packages/core` | `@tabalabs/upsure`, the upload client |
| `packages/react` | `@tabalabs/upsure-react`, the hook and the component |
| `packages/node` | `@tabalabs/upsure-node`, the server |
| `examples/react-node` | An example app that uses all three |

## Commands

Run these from the repository root.

| Command | What it does |
| --- | --- |
| `pnpm build` | Builds all packages. |
| `pnpm typecheck` | Checks types in all packages and the example. |
| `pnpm test` | Runs the unit and integration tests. |
| `pnpm test:e2e` | Starts the example app and uploads a file in a real browser. |
| `pnpm example` | Builds the packages and starts the example app at <http://localhost:5173>. |

`pnpm test:e2e` uses a browser that is already installed: a Chromium from an earlier Playwright install, otherwise Chrome, otherwise Edge. If it finds none, run `pnpm --filter upsure-example-react-node exec playwright-core install chromium`.

To run the tests of one package, add a filter: `pnpm --filter @tabalabs/upsure-node test`.

The same build, typecheck and tests run on GitHub for every pull request, on Node 20, 22 and 24.

## Before you open a pull request

- `pnpm build`, `pnpm typecheck` and `pnpm test` pass.
- Every new feature and every bug fix has a test.
- The README only describes what the code really does.
- New options are added sparingly. The public API is kept small on purpose.

## Branches

Name a branch `type/short-topic`:

| Type | For |
| --- | --- |
| `feat/` | A new feature, for example `feat/node-server` |
| `fix/` | A bug fix, for example `fix/core-retry` |
| `docs/` | Documentation, for example `docs/readme` |
| `test/` | Tests only |
| `chore/` | Tooling, CI, dependencies |

## Commits

The title starts with what kind of change it is, followed by the main change only:

```
Add: maxFileSize and allowedTypes options to the node server
Fix: retry starting from zero after a network error
Modified: drop Node 18 support
```

The description lists the details under the headings that apply:

```
Added:
- maxFileSize option, rejecting bigger uploads with 413
- Tests for the rejection status codes

Modified:
- upload.test.ts now uses the shared helpers

Deleted:
- The unused legacy helper
```

## Pull requests

Use the same format as a commit for the title and description, and add a `Testing:` section that says what you ran and what the tests cover.

## License

By contributing, you agree that your contribution is licensed under the [MIT license](./LICENSE).
