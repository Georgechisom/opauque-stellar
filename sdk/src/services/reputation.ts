/**
 * On-chain ZK reputation. Submit a V2 Groth16 proof to the reputation-verifier
 * (root validity + nullifier-replay enforced on-chain), read the latest published
 * root, and attest (delegated to the schema service). Proof *generation* needs the
 * proving layer (snarkjs + circuit artifacts + scanner) and is surfaced as a
 * not-wired capability in this build: bring a precomputed proof to verifyOnChain.
 */
import { NotWiredError } from "../errors/index";
import type { VerifyReputationInputs } from "../contracts/verifier";
import type { OpaqueClientContext } from "./context";
import type { SchemasService } from "./schemas";

export class ReputationService {
  constructor(
    private readonly ctx: OpaqueClientContext,
    private readonly schemas: SchemasService,
  ) {}

  /** Attest a reputation trait to a stealth identity (delegates to schemas). */
  attest(opts: Parameters<SchemasService["attest"]>[0]): Promise<string> {
    return this.schemas.attest(opts);
  }

  /** Submit a precomputed V2 reputation proof for on-chain verification. */
  async verifyOnChain(opts: VerifyReputationInputs): Promise<string> {
    const signer = this.ctx.requireSigner();
    return this.ctx.contracts.reputationVerifier.verifyReputation({
      ...opts,
      groth16VerifierId: this.ctx.config.contracts.groth16Verifier,
      signer,
    });
  }

  /** Read the latest published reputation Merkle root, or null if none. */
  async getLatestRoot(opts?: { source?: string }): Promise<Uint8Array | null> {
    const source = opts?.source ?? (await this.ctx.requireSigner().publicKey());
    return this.ctx.contracts.reputationVerifier.getLatestRoot(source);
  }

  /** Proof generation is not wired in this build. */
  prove(): never {
    throw new NotWiredError(
      "Reputation proof generation",
      "Provide a precomputed proof to verifyOnChain(), or use a build with the proving layer.",
    );
  }
}
