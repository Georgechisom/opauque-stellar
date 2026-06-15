import { Footer } from "./Footer";
import { Link } from "react-router-dom";
import {
  PRIVACY_NOT_HIDDEN,
  PRIVACY_PROVIDED,
  THREAT_MODEL_ROUTE,
} from "../lib/privacyThreatModel";

type LandingPageProps = {
  onEnterVault: () => void;
};

const FEATURES = [
  {
    icon: "↕",
    title: "Stealth payments",
    body: "Senders derive a fresh one-time receive surface from your stealth meta-address. Announcements let your wallet discover incoming XLM locally.",
  },
  {
    icon: "◌",
    title: "Privacy pool",
    body: "Deposit XLM under a private commitment. Once the ASP publishes an approved association-set root, a Groth16 proof withdraws without revealing which deposit funded it.",
  },
  {
    icon: "✦",
    title: "Proof-backed reputation",
    body: "An optional PSR layer. Groth16 proofs, Merkle roots, and nullifiers let apps verify traits without tying them to your public wallet.",
  },
  {
    icon: "⌘",
    title: "On-chain registry",
    body: "Link your Stellar account to a meta-address on Soroban so payers can resolve you without passing a long key every time.",
  },
  {
    icon: "⬡",
    title: "Browser-native crypto",
    body: "Rust compiled to WASM for secp256k1 scanning, snarkjs and Circom for pool and reputation proofs, running on-device with no server round-trips.",
  },
  {
    icon: "⛓",
    title: "Open contracts",
    body: "Registry, announcer, privacy pool, and verifier contracts on Soroban. No proprietary backend, so integrators use the same on-chain interfaces.",
  },
] as const;

const STEPS = [
  {
    n: "01",
    title: "Initialize",
    body: "Sign a message with Freighter to derive stealth keys locally. Nothing leaves your device.",
  },
  {
    n: "02",
    title: "Choose a privacy path",
    body: "Register a meta-address for stealth receives, or deposit XLM into the privacy pool under a note only your browser can spend.",
  },
  {
    n: "03",
    title: "Index roots",
    body: "Pool deposits and withdrawals update the state tree. The ASP publishes approved roots so wallets can prove membership against current on-chain state.",
  },
  {
    n: "04",
    title: "Withdraw or prove",
    body: "Withdraw from the pool with a nullifier-based proof, or generate a reputation proof scoped to an action without revealing your wallet.",
  },
] as const;

function Wordmark() {
  return (
    <span className="font-display text-lg font-bold tracking-tight text-white">
      Opaque<span className="text-glow">.</span>
    </span>
  );
}

export function LandingPage({ onEnterVault }: LandingPageProps) {
  return (
    <div className="min-h-dvh flex flex-col bg-ink-950 text-white overflow-x-hidden">
      {/* Slim top bar */}
      <header className="sticky top-0 z-30 border-b border-border-subtle bg-ink-950/85 backdrop-blur-lg">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Wordmark />
          <button
            type="button"
            onClick={onEnterVault}
            className="rounded-full bg-glow px-5 py-2 text-sm font-semibold text-ink-950 transition-colors hover:bg-[#ffe24f]"
          >
            Open wallet
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto w-full max-w-6xl px-5 sm:px-8 pt-20 sm:pt-28 md:pt-36 pb-20 md:pb-28">
        <div className="max-w-3xl">
          <span className="inline-flex items-center gap-2.5 rounded-full border border-border px-3.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-mist">
            <span className="h-1.5 w-1.5 rounded-full bg-glow" aria-hidden />
            Stellar · Stealth · Privacy pools
          </span>

          <h1 className="mt-7 font-display text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tight leading-[1.02] text-white">
            Privacy protocol
            <br />
            on Stellar<span className="text-glow">.</span>
          </h1>

          <p className="mt-7 max-w-2xl text-lg leading-relaxed text-mist">
            <span className="font-semibold text-white">Opaque</span> is a Stellar-native privacy
            layer: unlinkable receives, shielded XLM withdrawals through a{" "}
            <span className="font-semibold text-white">privacy pool</span>, optional ZK-backed
            reputation, and contracts you can verify on-chain.
          </p>

          <div className="mt-9 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={onEnterVault}
              className="group inline-flex items-center justify-center gap-2.5 rounded-full bg-glow px-7 py-3.5 text-sm font-semibold text-ink-950 transition-colors hover:bg-[#ffe24f]"
            >
              Open wallet
              <span className="transition-transform group-hover:translate-x-0.5" aria-hidden>
                →
              </span>
            </button>
            <Link
              to={THREAT_MODEL_ROUTE}
              className="inline-flex items-center justify-center rounded-full border border-border px-7 py-3.5 text-sm font-semibold text-white transition-colors hover:border-white/40"
            >
              Read the threat model
            </Link>
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <div className="h-px w-full bg-border-subtle" />
      </div>

      {/* Features */}
      <section className="mx-auto w-full max-w-6xl px-5 sm:px-8 pt-20 md:pt-28 pb-20 md:pb-28">
        <div className="mb-12 max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-glow">
            Core primitives
          </p>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
            What the protocol provides
          </h2>
        </div>

        <div className="grid gap-px overflow-hidden rounded-2xl border border-border-subtle bg-border-subtle sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="group bg-ink-950 p-7 transition-colors hover:bg-ink-900"
            >
              <span
                className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-glow/30 bg-glow/10 text-lg text-glow"
                aria-hidden
              >
                {f.icon}
              </span>
              <h3 className="font-display text-base font-bold text-white">{f.title}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-mist">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Steps */}
      <section className="mx-auto w-full max-w-4xl px-5 sm:px-8 pb-20 md:pb-28">
        <div className="mb-12 max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-glow">Flow</p>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
            How it works
          </h2>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {STEPS.map((s) => (
            <div
              key={s.n}
              className="rounded-2xl border border-border-subtle bg-ink-900 p-7 transition-colors hover:border-border"
            >
              <span className="font-mono text-sm font-bold tracking-widest text-glow">{s.n}</span>
              <h3 className="mt-4 font-display text-lg font-bold text-white">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-mist">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Privacy trade-offs */}
      <section className="mx-auto w-full max-w-4xl px-5 sm:px-8 pb-20 md:pb-28">
        <div className="rounded-3xl border border-border-subtle bg-ink-900 p-7 md:p-10">
          <h2 className="font-display text-2xl font-bold tracking-tight text-white">
            Privacy and trade-offs
          </h2>
          <div className="mt-7 grid gap-px overflow-hidden rounded-2xl border border-border-subtle bg-border-subtle md:grid-cols-2">
            <div className="bg-ink-950 p-6">
              <p className="font-display text-sm font-semibold text-glow">What is private</p>
              <ul className="mt-4 space-y-2.5 text-sm leading-relaxed text-mist">
                {PRIVACY_PROVIDED.map((item) => (
                  <li key={item} className="flex gap-2.5">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-glow" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-ink-950 p-6">
              <p className="font-display text-sm font-semibold text-white">What is not magic</p>
              <ul className="mt-4 space-y-2.5 text-sm leading-relaxed text-mist">
                {PRIVACY_NOT_HIDDEN.map((item) => (
                  <li key={item} className="flex gap-2.5">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-mist" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-6 text-sm text-mist">
            The privacy pool breaks the public link between an approved deposit and a later
            withdrawal, but amounts, timing, RPC queries, and the destination account still need
            operational care.{" "}
            <Link
              to={THREAT_MODEL_ROUTE}
              className="font-medium text-white underline decoration-glow underline-offset-4 hover:text-glow"
            >
              Read the full privacy threat model
            </Link>{" "}
            for adversaries, mitigations, and implementation mapping.
          </p>
        </div>
      </section>

      <div className="mt-auto shrink-0 w-full pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Footer />
      </div>
    </div>
  );
}
