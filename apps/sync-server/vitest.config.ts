import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Prevent tests from accidentally connecting to the dev database
    // (Vitest doesn't load .env by default, but this guards against future changes)
    env: {
      DATABASE_URL: "",
    },
  },
});
