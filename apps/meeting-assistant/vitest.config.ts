import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
    environmentMatchGlobs: [["electron/**/__tests__/**", "node"]],
    pool: "threads",
    maxWorkers: 4,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
    alias: {
      "@": resolve(__dirname, "src"),
      "@components": resolve(__dirname, "src/components"),
      "@pages": resolve(__dirname, "src/pages"),
      "@hooks": resolve(__dirname, "src/hooks"),
      "@lib": resolve(__dirname, "src/lib"),
      "@store": resolve(__dirname, "src/store"),
      "@types": resolve(__dirname, "src/types"),
      "@hidock/ai-providers": resolve(__dirname, "../../packages/ai-providers/src/index.ts"),
      "@hidock/calendar-sync": resolve(__dirname, "../../packages/calendar-sync/src/index.ts"),
    },
  },
});
