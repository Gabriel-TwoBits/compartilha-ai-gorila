import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Must track the PORT default in server/env.ts: in development Vite serves the
// UI and forwards /api, /partytracks and /ws to the Node server.
const DEFAULT_SERVER_PORT = "8787"
const backend = `http://localhost:${process.env.PORT ?? DEFAULT_SERVER_PORT}`

export default defineConfig({
  root: "client",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": backend,
      "/partytracks": backend,
      "/ws": { target: backend, ws: true },
    },
  },
})
