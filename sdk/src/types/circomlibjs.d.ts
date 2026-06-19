/**
 * Minimal ambient types for `circomlibjs`, which ships no type declarations.
 * Only the surface the SDK uses is declared; callers cast to a precise shape.
 */
declare module "circomlibjs" {
  /** Build a Poseidon hasher whose result carries an `F` field helper. */
  export function buildPoseidon(): Promise<unknown>;
}
