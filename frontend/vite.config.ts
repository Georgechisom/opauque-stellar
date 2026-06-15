import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), wasm(), topLevelAwait()],
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          stellar: ['@stellar/stellar-sdk', '@stellar/freighter-api'],
          crypto: ['@noble/curves', '@noble/hashes'],
          state: ['zustand', 'idb'],
          animation: ['framer-motion'],
          prover: ['snarkjs', 'circomlibjs'],
        },
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
