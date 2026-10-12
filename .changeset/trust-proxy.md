---
"@tabalabs/upsure-node": minor
---

Added the `trustProxy` option. Set it to `true` behind a reverse proxy such as nginx, so the upload URLs the server returns use `https` and the public host name from the proxy's forwarded headers.
