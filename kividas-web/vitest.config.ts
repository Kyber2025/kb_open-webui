import { defineConfig } from "vitest/config";

export default defineConfig({
  // Unit tests must not discover the parent application's PostCSS plugins.
  // A worktree may have this package's dependencies without the parent's.
  css: { postcss: { plugins: [] } },
  test: {
    environment: "node",
    // Threads end with the runner. Vitest 2's fork workers can survive a
    // startup failure and repeatedly allocate while reporting to a dead parent.
    pool: "threads",
    poolOptions: { threads: { minThreads: 1, maxThreads: 2 } },
  },
});
