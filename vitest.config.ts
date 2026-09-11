import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  test: {
    // Client tests cover the pure logic only — a preset table, a diff between
    // two room snapshots — so they need no DOM and run in the same node
    // environment as the rest.
    include: [
      "server/**/*.test.ts",
      "shared/**/*.test.ts",
      "client/**/*.test.ts",
      // The desktop shell has its own package, but its pure logic imports no
      // electron so it runs here — one `pnpm test` covers the whole repository.
      "desktop/src/**/*.test.ts",
    ],
    // server/env.ts refuses to load without these, by design.
    env: {
      SFU_APP_ID: "test-app-id",
      SFU_APP_TOKEN: "test-app-token",
      ROOM_PASSWORD: "test-room-password",
      SESSION_SECRET: "test-session-secret",
    },
  },
})
