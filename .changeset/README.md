# Changesets

This folder is used by [Changesets](https://github.com/changesets/changesets) to version and publish the packages.

When a pull request changes what a package does, add a changeset:

```sh
pnpm changeset
```

Pick the packages that changed, choose patch, minor or major, and describe the change in one line. Commit the file it creates. The description ends up in that package's `CHANGELOG.md` at the next release.
