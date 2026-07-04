import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      globals: {
        Buffer: true,
      },
    }),
  ],
  base: './', // Use relative paths for Scrypted plugin serving
  build: {
    outDir: '../fs/web',
    emptyOutDir: true,
  }
})
