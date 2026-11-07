import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "http://localhost/" } },
    include: ["tests/**/*.test.js"],
    allowOnly: false,
    passWithNoTests: false,
    retry: 0,
  },
});
