# @tabalabs/upsure-node

## 0.2.0

### Minor Changes

- ef0a1a1: Added the `allowedOrigins` option, which lists the websites whose pages may upload. Without it the server accepts uploads from pages on any website, as before.
- 51fdf02: Added the `trustProxy` option. Set it to `true` behind a reverse proxy such as nginx, so the upload URLs the server returns use `https` and the public host name from the proxy's forwarded headers.

### Patch Changes

- 04e72fd: Corrected the documentation: a quick start that works from an empty folder, a "Before production" checklist, where files are stored, and accurate descriptions of `onError` and `retryable`.

## 0.1.0

### Minor Changes

- Initial release
