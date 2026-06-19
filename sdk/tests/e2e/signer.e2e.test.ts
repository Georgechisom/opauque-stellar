/**
 * End-to-end signer: a keypair signer signs a real Stellar transaction XDR and
 * the signature verifies against the account's public key. Confirms the SDK's
 * signer abstraction produces network-valid signatures.
 */
import { describe, it, expect } from "vitest";
import {
  Account,
  Keypair,
  Operation,
  TransactionBuilder,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { keypairSigner, callbackSigner, SignerError } from "../../src/index";

const PASSPHRASE = "Test SDF Network ; September 2015";

function buildUnsignedXdr(source: string): string {
  const account = new Account(source, "0");
  return new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(Operation.bumpSequence({ bumpTo: "1" }))
    .setTimeout(60)
    .build()
    .toXDR();
}

describe("keypair signer (end to end)", () => {
  it("signs a transaction with a valid, verifiable signature", async () => {
    const keypair = Keypair.random();
    const signer = keypairSigner(keypair.secret());
    expect(await signer.publicKey()).toBe(keypair.publicKey());

    const unsigned = buildUnsignedXdr(keypair.publicKey());
    const signedXdr = await signer.signTransaction(unsigned, {
      networkPassphrase: PASSPHRASE,
    });

    const signed = TransactionBuilder.fromXDR(signedXdr, PASSPHRASE);
    expect(signed.signatures.length).toBe(1);
    // The signature must verify against the signing account's key.
    const hash = signed.hash();
    expect(keypair.verify(hash, signed.signatures[0].signature())).toBe(true);
  });

  it("accepts a Keypair instance directly", async () => {
    const keypair = Keypair.random();
    const signer = keypairSigner(keypair);
    const signedXdr = await signer.signTransaction(
      buildUnsignedXdr(keypair.publicKey()),
      { networkPassphrase: PASSPHRASE },
    );
    expect(TransactionBuilder.fromXDR(signedXdr, PASSPHRASE).signatures.length).toBe(1);
  });

  it("wraps signing failures in SignerError", async () => {
    const signer = keypairSigner(Keypair.random());
    await expect(
      signer.signTransaction("not-valid-xdr", { networkPassphrase: PASSPHRASE }),
    ).rejects.toBeInstanceOf(SignerError);
  });
});

describe("callback signer (end to end)", () => {
  it("delegates to the provided callback", async () => {
    const keypair = Keypair.random();
    const signer = callbackSigner({
      publicKey: keypair.publicKey(),
      signTransaction: async (xdr) => {
        const tx = TransactionBuilder.fromXDR(xdr, PASSPHRASE);
        tx.sign(keypair);
        return tx.toXDR();
      },
    });
    const signedXdr = await signer.signTransaction(
      buildUnsignedXdr(keypair.publicKey()),
      { networkPassphrase: PASSPHRASE },
    );
    expect(TransactionBuilder.fromXDR(signedXdr, PASSPHRASE).signatures.length).toBe(1);
  });

  it("wraps callback failures in SignerError", async () => {
    const signer = callbackSigner({
      publicKey: "G".padEnd(56, "A"),
      signTransaction: async () => {
        throw new Error("user rejected");
      },
    });
    await expect(
      signer.signTransaction("xdr", { networkPassphrase: PASSPHRASE }),
    ).rejects.toBeInstanceOf(SignerError);
  });
});
