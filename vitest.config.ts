import { defineConfig, configDefaults } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30000,
    setupFiles: ["./tests/setup.ts"],
    exclude: [...configDefaults.exclude, "**/.agents/**", "**/.worktrees/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
})
