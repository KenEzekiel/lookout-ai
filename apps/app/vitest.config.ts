import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "http://localhost:3000" } },
    include: ["tests/integration/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/support/setup.ts"],
    allowOnly: false,
    passWithNoTests: false,
    retry: 0,
  },
});
