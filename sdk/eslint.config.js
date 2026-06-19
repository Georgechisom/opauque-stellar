import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", "docs/.vitepress/cache", "docs/.vitepress/dist", "node_modules", "examples"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // The SDK bridges untyped libraries (snarkjs, circomlibjs, tweetnacl) and
      // decodes dynamic on-chain values, so localized casts to/through unknown
      // are intentional. `any` is still disallowed.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
