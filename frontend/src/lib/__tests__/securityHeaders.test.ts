import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const REQUIRED_HEADERS = {
  "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
};

function readFrontendFile(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}

describe("security headers", () => {
  it("keeps static host headers configured", () => {
    const headers = readFrontendFile("public/_headers");

    for (const [name, value] of Object.entries(REQUIRED_HEADERS)) {
      expect(headers.toLowerCase()).toContain(name);
      expect(headers).toContain(value);
    }
  });

  it("keeps Vercel headers configured", () => {
    const vercel = JSON.parse(readFrontendFile("vercel.json")) as {
      headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    };
    const rootHeaders = new Map(
      vercel.headers
        .find((entry) => entry.source === "/(.*)")
        ?.headers.map((header) => [header.key.toLowerCase(), header.value]),
    );

    for (const [name, value] of Object.entries(REQUIRED_HEADERS)) {
      expect(rootHeaders.get(name)).toBe(value);
    }
  });

  it("verifies deployed staging headers when a URL is configured", async () => {
    const url = process.env.OPAQUE_STAGING_URL ?? process.env.VITE_STAGING_URL ?? process.env.DEPLOYED_FRONTEND_URL;

    if (!url) {
      return;
    }

    const response = await fetch(url, { redirect: "manual" });
    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(400);

    for (const [name, value] of Object.entries(REQUIRED_HEADERS)) {
      expect(response.headers.get(name)).toBe(value);
    }
  });
});
