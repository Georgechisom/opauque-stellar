import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const chunkGroups: Array<[string, string[]]> = [
  [
    'polyfills',
    [
      '/node_modules/buffer/',
      '/node_modules/base64-js/',
      '/node_modules/ieee754/',
      '/node_modules/process/',
    ],
  ],
  [
    'vendor',
    [
      '/node_modules/react/',
      '/node_modules/react-dom/',
      '/node_modules/react-router/',
      '/node_modules/react-router-dom/',
    ],
  ],
  ['stellar', ['/node_modules/@stellar/stellar-sdk/', '/node_modules/@stellar/freighter-api/']],
  ['crypto', ['/node_modules/@noble/curves/', '/node_modules/@noble/hashes/']],
  ['state', ['/node_modules/zustand/', '/node_modules/idb/']],
  ['animation', ['/node_modules/framer-motion/']],
  ['prover', ['/node_modules/snarkjs/', '/node_modules/circomlibjs/']],
]

function manualChunks(id: string) {
  const normalizedId = id.replaceAll('\\', '/')
  const match = chunkGroups.find(([, modulePaths]) =>
    modulePaths.some((modulePath) => normalizedId.includes(modulePath)),
  )
  return match?.[0]
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), wasm(), topLevelAwait()],
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  resolve: {
    alias: [
      { find: '@wasm', replacement: path.resolve(__dirname, 'public/pkg') },
      { find: '@deployments', replacement: path.resolve(__dirname, '../deployments') },
      { find: '@relayer', replacement: path.resolve(__dirname, '../relayer/src') },
      {
        find: '@stellar/stellar-sdk',
        replacement: path.resolve(__dirname, 'node_modules/@stellar/stellar-sdk'),
      },
      { find: '@noble/hashes', replacement: path.resolve(__dirname, 'node_modules/@noble/hashes') },
      { find: 'tweetnacl', replacement: path.resolve(__dirname, 'node_modules/tweetnacl') },
      { find: /^buffer$/, replacement: path.resolve(__dirname, 'node_modules/buffer/index.js') },
      { find: /^process$/, replacement: path.resolve(__dirname, 'node_modules/process/browser.js') },
      {
        find: /^process\/browser$/,
        replacement: path.resolve(__dirname, 'node_modules/process/browser.js'),
      },
    ],
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
  },
  optimizeDeps: {
    // Prevent Vite from pre-bundling/corrupting the WASM binary
    exclude: ['cryptography', '@wasm/cryptography.js', '/pkg/cryptography.js'],
  },
})
