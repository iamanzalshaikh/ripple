import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["electron/**/__tests__/**/*.spec.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
