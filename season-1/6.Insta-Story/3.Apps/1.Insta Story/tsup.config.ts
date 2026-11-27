import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    server: "src/server.ts",
    consumers: "src/consumers.ts",
    "seed-products": "src/seed/seed-products.ts",
    "seed-insta": "src/seed/seed-insta.ts",
    boost: "src/seed/boost.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  sourcemap: true,
  bundle: true,
});
