import { createServer } from "node:http";
import { createRelayerHttpServer } from "../src/http.ts";
import { MemoryGossipTransport } from "../src/gossip.ts";
import { RelayerHub } from "../src/hub.ts";

const endpoint = process.env.RELAYER_GATEWAY_ENDPOINT?.trim() || "http://127.0.0.1:8787";
const endpointPort = new URL(endpoint).port;
const port = Number(process.env.RELAYER_PORT ?? (endpointPort || 8787));

const transport = new MemoryGossipTransport();
const hub = new RelayerHub(transport);
await hub.start();

const server: ReturnType<typeof createServer> = createRelayerHttpServer(hub);
server.listen(port, () => {
  console.log(`Opaque relayer hub listening on ${endpoint}`);
});
