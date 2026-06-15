// circomlibjs ships no type declarations; we only use buildPoseidon dynamically.
declare module "circomlibjs" {
  export function buildPoseidon(): Promise<any>;
}
