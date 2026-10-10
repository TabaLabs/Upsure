import { type AddressInfo, connect, createServer, type Socket } from "node:net";
import { onCleanup } from "./helpers";

export interface FlakyProxy {
  /** Full URL of the upload endpoint, going through the proxy. */
  endpoint: string;
  /** Bytes forwarded from the client to the server so far. */
  bytesSent(): number;
  /** How many times the proxy has cut a connection. */
  drops(): number;
  /** Cuts the connection once, as soon as `bytes` more bytes have been sent. */
  dropAfter(bytes: number): void;
  /** Points the proxy at another server port. */
  setTarget(port: number): void;
}

/**
 * A TCP proxy between the tus client and the server that can cut the
 * connection in the middle of a request by destroying both sockets, the way a
 * real network failure would. It is torn down after the test.
 */
export async function startProxy(targetPort: number): Promise<FlakyProxy> {
  const sockets = new Set<Socket>();
  let target = targetPort;
  let sent = 0;
  let drops = 0;
  let dropAt: number | undefined;

  const server = createServer((client) => {
    const upstream = connect(target, "127.0.0.1");
    const destroyBoth = () => {
      client.destroy();
      upstream.destroy();
    };
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.on("error", destroyBoth);
      socket.on("close", () => {
        sockets.delete(socket);
        destroyBoth();
      });
    }

    upstream.pipe(client);
    client.on("data", (chunk) => {
      if (dropAt !== undefined && sent + chunk.length >= dropAt) {
        dropAt = undefined;
        drops += 1;
        destroyBoth();
        return;
      }
      sent += chunk.length;
      if (!upstream.write(chunk)) {
        client.pause();
        upstream.once("drain", () => client.resume());
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  onCleanup(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });

  return {
    endpoint: `http://127.0.0.1:${port}/uploads`,
    bytesSent: () => sent,
    drops: () => drops,
    dropAfter(bytes) {
      dropAt = sent + bytes;
    },
    setTarget(nextPort) {
      target = nextPort;
    },
  };
}
