import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    server: "src/server.ts",
    workers: "src/workers.ts",
    "ai-check": "src/ai/ai.check.ts",
    "seed-products": "src/seed/seed-products.ts",
    "seed-traffic": "src/seed/seed-traffic.ts",
    reindex: "src/search/reindex.ts",
    "eval-search": "src/search/eval/eval-search.ts",
    checks: "src/checks.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  sourcemap: true,
  bundle: true,
});
