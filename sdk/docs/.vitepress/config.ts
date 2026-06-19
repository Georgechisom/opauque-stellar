import { defineConfig } from "vitepress";

export default defineConfig({
  title: "@opaquecash/stellar",
  description:
    "Stealth private payments, privacy pools, relayer-market submission, and on-chain ZK reputation for Stellar / Soroban.",
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Concepts", link: "/concepts/stealth-payments" },
      { text: "Reference", link: "/reference/client" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting Started", link: "/guide/getting-started" },
          { text: "Node (server keypair)", link: "/guide/node" },
          { text: "Browser (Freighter)", link: "/guide/browser" },
        ],
      },
      {
        text: "Concepts",
        items: [
          { text: "Stealth Payments", link: "/concepts/stealth-payments" },
          { text: "ZK Reputation", link: "/concepts/zk-reputation" },
          { text: "Privacy Pool", link: "/concepts/privacy-pool" },
          { text: "Relayer Market", link: "/concepts/relayer-market" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "OpaqueClient", link: "/reference/client" },
          { text: "Security Model", link: "/reference/security" },
        ],
      },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/opaquecash/stellar" },
    ],
    footer: {
      message: "Released under the MIT License.",
      copyright: "Opaque Cash",
    },
  },
});
