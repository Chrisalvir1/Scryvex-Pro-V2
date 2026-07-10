import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Use './' for relative paths, critical for Home Assistant Ingress
  base: './',
  plugins: [react()],
  server: {
    proxy: {
      // Forward all /api REST calls AND WebSocket upgrades to the Express BFF.
      // Port 19090 is the insecure HTTP port exposed by scrypted-server-main.ts
      // (SCRYPTED_INSECURE_PORT). We use HTTP here because the Vite dev server
      // cannot easily terminate TLS for the self-signed cert on 9090.
      '/api': {
        target: 'http://localhost:19090',
        changeOrigin: true,
        ws: true,          // <-- tunnels WebSocket upgrade for /api/ws/cameras
        secure: false,     // ignore self-signed cert if target ever switches to HTTPS
      },
    },
  },
})
