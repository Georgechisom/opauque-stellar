/**
 * NaCl `crypto_box` sealing for relayer payloads. `tweetnacl` is an optional peer
 * dependency, loaded lazily so consumers that never touch the relayer market do
 * not need it installed.
 */
import { assertLength, base64ToBytes, bytesToBase64, concatBytes } from "./bytes";

const PUBLIC_KEY_BYTES = 32;
const SECRET_KEY_BYTES = 32;
const NONCE_BYTES = 24;

function randomBytes(len: number): Uint8Array {
  const out = new Uint8Array(len);
  globalThis.crypto.getRandomValues(out);
  return out;
}

type KeyPair = { publicKey: Uint8Array; secretKey: Uint8Array };
interface NaclBox {
  (msg: Uint8Array, nonce: Uint8Array, theirPk: Uint8Array, mySk: Uint8Array): Uint8Array;
  open(box: Uint8Array, nonce: Uint8Array, theirPk: Uint8Array, mySk: Uint8Array): Uint8Array | null;
  keyPair: { (): KeyPair; fromSecretKey(sk: Uint8Array): KeyPair };
  overheadLength: number;
}
interface Nacl {
  box: NaclBox;
}

async function getNacl(): Promise<Nacl> {
  try {
    return ((await import("tweetnacl")) as unknown as { default: Nacl }).default;
  } catch (cause) {
    throw new Error(
      "tweetnacl is required for relayer payload encryption; install it as a peer dependency.",
      { cause },
    );
  }
}

export type X25519Keypair = {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
};

export async function generateX25519Keypair(seed?: Uint8Array): Promise<X25519Keypair> {
  const nacl = await getNacl();
  if (seed) {
    const secretKey = assertLength(seed, SECRET_KEY_BYTES, "x25519 seed");
    const pair = nacl.box.keyPair.fromSecretKey(secretKey);
    return { publicKey: pair.publicKey, secretKey: pair.secretKey };
  }
  const pair = nacl.box.keyPair();
  return { publicKey: pair.publicKey, secretKey: pair.secretKey };
}

export async function sealBox(
  plaintext: Uint8Array,
  recipientPublicKey: Uint8Array,
): Promise<string> {
  const nacl = await getNacl();
  const to = assertLength(recipientPublicKey, PUBLIC_KEY_BYTES, "recipient x25519 public key");
  const eph = nacl.box.keyPair();
  const nonce = randomBytes(NONCE_BYTES);
  const ciphertext = nacl.box(plaintext, nonce, to, eph.secretKey);
  return bytesToBase64(concatBytes(eph.publicKey, nonce, ciphertext));
}

export async function openBox(box: string, recipientSecretKey: Uint8Array): Promise<Uint8Array> {
  const nacl = await getNacl();
  const secret = assertLength(recipientSecretKey, SECRET_KEY_BYTES, "recipient x25519 secret key");
  const raw = base64ToBytes(box);
  if (raw.length < PUBLIC_KEY_BYTES + NONCE_BYTES + nacl.box.overheadLength) {
    throw new Error("Encrypted payload is too short.");
  }
  const epk = raw.slice(0, PUBLIC_KEY_BYTES);
  const nonce = raw.slice(PUBLIC_KEY_BYTES, PUBLIC_KEY_BYTES + NONCE_BYTES);
  const ciphertext = raw.slice(PUBLIC_KEY_BYTES + NONCE_BYTES);
  const opened = nacl.box.open(ciphertext, nonce, epk, secret);
  if (!opened) throw new Error("Could not decrypt relayer payload.");
  return opened;
}
