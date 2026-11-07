import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/api/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    allowOnly: false,
    passWithNoTests: false,
    retry: 0,
  },
});
