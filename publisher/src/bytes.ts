export function normalizeHex32(value: string, label = "value"): string {
  const clean = value.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error(`${label} must be a 32-byte hex string`);
  }
  return `0x${clean}`;
}

export function bigintToHex32(value: bigint): string {
  if (value < 0n) throw new Error("value must be non-negative");
  if (value > (1n << 256n) - 1n) throw new Error("value must fit in 32 bytes");
  return `0x${value.toString(16).padStart(64, "0")}`;
}

export function hex32ToBytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(normalizeHex32(value).slice(2), "hex"));
}

export function bytesToHex32(bytes: Uint8Array): string {
  if (bytes.length !== 32) throw new Error("expected 32 bytes");
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

export function parseLeafValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("0x") || /^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return normalizeHex32(trimmed, "leaf");
  }
  return bigintToHex32(BigInt(trimmed));
}
