import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "packages/**/*.test.ts", "apps/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/vendor/**"],
    environment: "node",
    reporters: "default",
    // Run tests in a single thread so imports that mutate module state (e.g.
    // the ports.ts reserved-set) stay isolated and predictable.
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
  resolve: {
    alias: {
      "@omni/shared": new URL("./packages/shared/src/index.ts", import.meta.url).pathname,
    },
  },
});
