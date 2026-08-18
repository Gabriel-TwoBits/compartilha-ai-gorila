import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  test: {
    include: ["server/**/*.test.ts", "shared/**/*.test.ts"],
    // server/env.ts refuses to load without these, by design.
    env: {
      SFU_APP_ID: "test-app-id",
      SFU_APP_TOKEN: "test-app-token",
      ROOM_PASSWORD: "test-room-password",
      SESSION_SECRET: "test-session-secret",
    },
  },
})
