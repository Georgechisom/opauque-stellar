import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // @opaquecash/stellar's main entry re-exports the Node-only
      // fileArtifactResolver from the same barrel as the browser-safe APIs
      // this example uses, so bundlers need `fs` resolvable even though this
      // example never calls it. See src/shims/node-fs-shim.ts.
      fs: path.resolve(__dirname, "src/shims/node-fs-shim.ts"),
    },
  },
});
