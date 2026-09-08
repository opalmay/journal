import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // The AI worker and SQLite are shared process state; keep suites serial.
    fileParallelism: false,
  },
});
