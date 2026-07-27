/**
 * Browser stub for Node's `fs`, aliased in vite.config.ts.
 *
 * `@opaquecash/stellar`'s main entry re-exports `fileArtifactResolver`
 * (Node-only, reads circuit files from disk) from the same barrel as the
 * browser-safe client/signer/payments APIs this example actually uses, so
 * bundlers pull in `fs` unconditionally even though this example never calls
 * `fileArtifactResolver`. These stubs only exist to satisfy the bundler;
 * calling them for real in a browser is a bug in the caller, not something to
 * silently support, so they throw.
 */
function unsupported(name: string): never {
  throw new Error(
    `fs.${name} is not available in the browser. This example never calls ` +
      "fileArtifactResolver (Node-only); if you need proof generation in a " +
      "browser app, resolve circuit artifacts over HTTP instead.",
  );
}

export function readFileSync(): never {
  return unsupported("readFileSync");
}

export function writeFileSync(): never {
  return unsupported("writeFileSync");
}

export default { readFileSync, writeFileSync };
