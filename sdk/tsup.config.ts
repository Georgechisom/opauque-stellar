import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("./package.json", "utf8")) as {
  version: string;
};

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "crypto/index": "src/crypto/index.ts",
    "relayer-protocol/index": "src/relayer-protocol/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  target: "es2022",
  // Inject the package version so `VERSION` always matches package.json (single
  // source of truth; Changesets bumps only package.json).
  define: {
    __SDK_VERSION__: JSON.stringify(version),
  },
});
