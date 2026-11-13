import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2023",
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        game: resolve(__dirname, "index.html"),
        launcher: resolve(__dirname, "launcher.html"),
      },
    },
  },
  server: { port: 5173, strictPort: true },
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
    coverage: { include: ["src/rules/**"], provider: "v8" },
  },
});
