/**
 * Error-report scrubber tests (#560).
 *
 * These run against fixture payloads that deliberately contain every kind of secret
 * the wallet handles. Each test asserts the secret is ABSENT from the output, not
 * merely that some placeholder is present — a scrubber that adds a placeholder while
 * leaving the original in place would pass the weaker assertion.
 */

import { describe, it, expect } from "vitest";
import {
  REDACTED,
  coarsenTimestamp,
  scrubStack,
  scrubText,
  scrubUserAgent,
  scrubValue,
} from "../errorScrubber";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const ACCOUNT = "GA5XIGA5C7QTPTWXQHY6MCJRMTRZDOSHR6EFIBNDQTCQHG262N4GGKTM";
const CONTRACT = "CA5XIGA5C7QTPTWXQHY6MCJRMTRZDOSHR6EFIBNDQTCQHG262N4GGKTM";
const SECRET_SEED = "SA5XIGA5C7QTPTWXQHY6MCJRMTRZDOSHR6EFIBNDQTCQHG262N4GGKTM";
const NULLIFIER_HEX = "3f9a1c2b8e7d6054aa11bb22cc33dd44ee55ff66007788990011223344556677";
const MNEMONIC =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";

/** A realistic note-spending payload — every field here is spending material. */
const NOTE_FIXTURE = {
  cluster: "testnet",
  poolId: CONTRACT,
  value: "125000000",
  scope: 7,
  leafIndex: 12,
  nullifier: "88123456789012345678901234567890",
  secret: "99123456789012345678901234567890",
  commitment: `0x${NULLIFIER_HEX}`,
  spent: false,
};

const WITHDRAWAL_FIXTURE = {
  recipient: ACCOUNT,
  relayer: ACCOUNT,
  amountStroops: 125_000_000n,
  feeStroops: 1_000_000,
  proof: { pi_a: [NULLIFIER_HEX, NULLIFIER_HEX] },
  note: NOTE_FIXTURE,
  paymentLink: `https://app.opaque.xyz/pay?to=${ACCOUNT}&amount=12.5`,
};

function flatten(value: unknown): string {
  return JSON.stringify(value);
}

// ─── Text ───────────────────────────────────────────────────────────────────

describe("scrubText: addresses (#560)", () => {
  it("removes a Stellar account address entirely", () => {
    const out = scrubText(`Withdraw failed for ${ACCOUNT}`);
    expect(out).not.toContain(ACCOUNT);
    expect(out).toContain(REDACTED.account);
  });

  it("removes a Soroban contract address", () => {
    const out = scrubText(`Contract ${CONTRACT} reverted`);
    expect(out).not.toContain(CONTRACT);
    expect(out).toContain(REDACTED.contract);
  });

  it("removes a secret seed and never mistakes it for a public account", () => {
    const out = scrubText(`key=${SECRET_SEED}`);
    expect(out).not.toContain(SECRET_SEED);
    expect(out).toContain(REDACTED.secretKey);
    expect(out).not.toContain(REDACTED.account);
  });

  it("removes several addresses in one message", () => {
    const out = scrubText(`${ACCOUNT} -> ${ACCOUNT} via ${CONTRACT}`);
    expect(out).not.toContain(ACCOUNT);
    expect(out).not.toContain(CONTRACT);
  });
});

describe("scrubText: key material (#560)", () => {
  it("replaces long hex with a byte-count marker and no prefix", () => {
    const out = scrubText(`nullifierHash=0x${NULLIFIER_HEX}`);
    expect(out).not.toContain(NULLIFIER_HEX);
    expect(out).not.toContain(NULLIFIER_HEX.slice(0, 8));
    expect(out).toContain("[hex:32b]");
  });

  it("replaces base64 blobs", () => {
    const blob = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5YWJjZGVm";
    const out = scrubText(`box=${blob}`);
    expect(out).not.toContain(blob);
  });

  it("removes a BIP39 mnemonic", () => {
    const out = scrubText(`recovery phrase: ${MNEMONIC}`);
    expect(out).not.toContain("sausage");
    expect(out).toContain(REDACTED.mnemonic);
  });

  it("removes an email address", () => {
    const out = scrubText("contact user@example.com for details");
    expect(out).not.toContain("user@example.com");
    expect(out).toContain(REDACTED.email);
  });
});

describe("scrubText: amounts (#560)", () => {
  it("removes decimal amounts", () => {
    const out = scrubText("Withdrew 12.5 to the recipient");
    expect(out).not.toContain("12.5");
    expect(out).toContain(REDACTED.amount);
  });

  it("removes unit-qualified amounts", () => {
    const out = scrubText("balance 125000000 stroops (12.5 XLM)");
    expect(out).not.toContain("125000000");
    expect(out).not.toContain("12.5");
  });

  it("removes bare stroop-sized integers", () => {
    const out = scrubText("value=125000000n");
    expect(out).not.toContain("125000000");
  });

  it("keeps small numbers that are useful for triage", () => {
    expect(scrubText("leaf index 12 of depth 20")).toContain("12");
  });
});

describe("scrubText: URLs (#560)", () => {
  it("strips the query string from a payment link", () => {
    const out = scrubText(`opened https://app.opaque.xyz/pay?to=${ACCOUNT}&amount=12.5`);
    expect(out).not.toContain(ACCOUNT);
    expect(out).not.toContain("amount=12.5");
    expect(out).toContain("https://app.opaque.xyz/pay");
    expect(out).toContain(REDACTED.query);
  });

  it("keeps a bare origin usable", () => {
    expect(scrubText("rpc https://soroban-testnet.stellar.org")).toContain(
      "https://soroban-testnet.stellar.org",
    );
  });
});

describe("scrubText: idempotence (#560)", () => {
  it("is stable under a second pass", () => {
    const fixture = `${ACCOUNT} sent 12.5 XLM, seed ${SECRET_SEED}, hash 0x${NULLIFIER_HEX}, ${MNEMONIC}`;
    const once = scrubText(fixture);
    expect(scrubText(once)).toBe(once);
  });
});

// ─── Structured payloads ────────────────────────────────────────────────────

describe("scrubValue: note-spending fixture (#560)", () => {
  const scrubbed = flatten(scrubValue(NOTE_FIXTURE));

  it("drops the nullifier, secret, and commitment by key", () => {
    expect(scrubbed).not.toContain("88123456789012345678901234567890");
    expect(scrubbed).not.toContain("99123456789012345678901234567890");
    expect(scrubbed).not.toContain(NULLIFIER_HEX);
  });

  it("drops the pool address and the value", () => {
    expect(scrubbed).not.toContain(CONTRACT);
    expect(scrubbed).not.toContain("125000000");
  });

  it("keeps non-identifying diagnostics", () => {
    const out = scrubValue(NOTE_FIXTURE) as Record<string, unknown>;
    expect(out.cluster).toBe("testnet");
    expect(out.leafIndex).toBe(12);
    expect(out.spent).toBe(false);
  });
});

describe("scrubValue: withdrawal fixture (#560)", () => {
  const scrubbed = flatten(scrubValue(WITHDRAWAL_FIXTURE));

  it("leaks no address, amount, or proof material", () => {
    for (const secret of [
      ACCOUNT,
      CONTRACT,
      NULLIFIER_HEX,
      "125000000",
      "amount=12.5",
    ]) {
      expect(scrubbed).not.toContain(secret);
    }
  });

  it("redacts bigint and numeric amounts", () => {
    const out = scrubValue(WITHDRAWAL_FIXTURE) as Record<string, unknown>;
    expect(out.amountStroops).toBe(REDACTED.amount);
    expect(out.feeStroops).toBe(REDACTED.amount);
  });

  it("drops secret-named keys without inspecting their value", () => {
    const out = scrubValue({ nullifier: { nested: { deep: ACCOUNT } } }) as Record<
      string,
      unknown
    >;
    expect(out.nullifier).toBe(REDACTED.value);
  });
});

describe("scrubValue: hostile input (#560)", () => {
  it("collapses cycles instead of hanging", () => {
    const cyclic: Record<string, unknown> = { network: "testnet" };
    cyclic.self = cyclic;
    expect(() => flatten(scrubValue(cyclic))).not.toThrow();
    expect(flatten(scrubValue(cyclic))).toContain("[circular]");
  });

  it("bounds long arrays", () => {
    const out = scrubValue({ items: Array.from({ length: 50 }, (_, i) => i) }) as {
      items: unknown[];
    };
    expect(out.items.length).toBeLessThanOrEqual(21);
    expect(out.items.at(-1)).toContain("more");
  });

  it("bounds deep nesting", () => {
    let deep: Record<string, unknown> = { network: "testnet" };
    for (let i = 0; i < 20; i += 1) deep = { child: deep };
    expect(flatten(scrubValue(deep))).toContain("[depth-limit]");
  });

  it("summarises byte arrays by length", () => {
    expect(scrubValue(new Uint8Array(32))).toBe("[bytes:32]");
  });

  it("scrubs a nested Error's message and stack", () => {
    const err = new Error(`failed for ${ACCOUNT}`);
    const out = scrubValue({ err }) as { err: { message: string } };
    expect(out.err.message).not.toContain(ACCOUNT);
  });
});

// ─── Environment ────────────────────────────────────────────────────────────

describe("scrubStack (#560)", () => {
  it("reduces file paths to file:line:col and drops local directories", () => {
    const stack = [
      "Error: boom",
      "    at generateWithdrawProof (/home/alice/opaque/frontend/src/lib/poolProver.ts:372:20)",
      "    at async https://app.opaque.xyz/assets/index-a1b2c3.js:12:9",
    ].join("\n");
    const frames = scrubStack(stack);
    expect(frames.join("\n")).not.toContain("/home/alice");
    expect(frames[0]).toContain("poolProver.ts:372:20");
  });

  it("scrubs secrets that leaked into a frame", () => {
    const stack = `Error: boom\n    at submit (${ACCOUNT}.js:1:1)`;
    expect(scrubStack(stack).join("")).not.toContain(ACCOUNT);
  });

  it("caps the number of frames and handles a missing stack", () => {
    const stack = ["Error: boom", ...Array.from({ length: 40 }, (_, i) => `    at f${i} (a.ts:${i}:1)`)].join("\n");
    expect(scrubStack(stack)).toHaveLength(8);
    expect(scrubStack(undefined)).toEqual([]);
  });
});

describe("scrubUserAgent (#560)", () => {
  it("coarsens to browser + platform", () => {
    expect(
      scrubUserAgent(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ),
    ).toBe("Chrome on Linux");
    expect(scrubUserAgent("Mozilla/5.0 (Macintosh) Gecko/20100101 Firefox/121.0")).toBe(
      "Firefox on macOS",
    );
    expect(scrubUserAgent(undefined)).toBe("unknown");
  });

  it("drops the exact version string", () => {
    expect(scrubUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.6099.71")).not.toContain(
      "6099",
    );
  });
});

describe("coarsenTimestamp (#560)", () => {
  it("rounds down to the hour so reports cannot be matched to a ledger", () => {
    const t = Date.UTC(2026, 6, 26, 14, 37, 51, 123);
    expect(coarsenTimestamp(t)).toBe(Date.UTC(2026, 6, 26, 14, 0, 0, 0));
  });
});
