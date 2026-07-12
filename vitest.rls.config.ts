import path from "node:path";
import { defineConfig } from "vitest/config";

// Suite de segurança RLS — executada por `npm run test:rls`
// (scripts/test-rls.sh) contra um PostgreSQL real.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/rls/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Testes compartilham um único banco: executar em série.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
