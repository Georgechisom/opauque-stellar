import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { RelayerEngine } from "./engine.ts";
import { validateAdvert, validatePayload, type RelayerBid } from "./messages.ts";

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export function createRelayerHttpServer(engine: RelayerEngine) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "POST" && url.pathname === "/v1/jobs") {
        const advert = validateAdvert(await readJson(req));
        const bid = await engine.handleAdvert(advert);
        send(res, 202, { ok: true, bid });
        return;
      }
      const bidMatch = /^\/v1\/jobs\/([^/]+)\/bids$/.exec(url.pathname);
      if (req.method === "GET" && bidMatch) {
        const bids: RelayerBid[] = engine.bidsFor(decodeURIComponent(bidMatch[1]));
        send(res, 200, { bids });
        return;
      }
      const payloadMatch = /^\/v1\/jobs\/([^/]+)\/payload$/.exec(url.pathname);
      if (req.method === "POST" && payloadMatch) {
        const payload = validatePayload(await readJson(req));
        if (payload.jobId.toLowerCase() !== decodeURIComponent(payloadMatch[1]).toLowerCase()) {
          send(res, 400, { error: "jobId mismatch" });
          return;
        }
        const result = await engine.handlePayload(payload);
        send(res, 202, { ok: true, result });
        return;
      }
      if (req.method === "GET" && url.pathname === "/health") {
        send(res, 200, { ok: true, stats: engine.stats });
        return;
      }
      send(res, 404, { error: "not found" });
    } catch (err) {
      send(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  });
}
