---
layout: home

hero:
  name: "@opaquecash/stellar"
  text: "Privacy primitives for Stellar"
  tagline: Stealth payments, privacy pools, relayer-market submission, and on-chain ZK reputation — one typed, framework-free package.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Concepts
      link: /concepts/stealth-payments

features:
  - title: Stealth private payments
    details: Derive one-time addresses (DKSAP), send XLM unlinkably, and scan for incoming transfers — all in pure TypeScript.
  - title: On-chain ZK reputation
    details: Generate a Groth16 proof in-process and verify it inside a Soroban contract (Protocol 25+ host functions).
  - title: Privacy pool
    details: Deposit and withdraw through a shielded pool with an off-chain state root and on-chain custody invariant.
  - title: Relayer market
    details: Submit pool withdrawals through a staked market relayer so the funding wallet never touches the withdrawal.
  - title: Framework-free + isomorphic
    details: Zero React/DOM dependency. Runs in Node and the browser. Bring Freighter or a raw server keypair.
  - title: Typed and tree-shakeable
    details: ESM + CJS, full type declarations, subpath exports, and a flat OpaqueClient surface over typed contract bindings.
---
