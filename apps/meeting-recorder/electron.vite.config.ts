import { resolve } from "path";
import { copyFileSync, mkdirSync, existsSync } from "fs";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

/**
 * Simple Vite plugin to copy models.config.json to the build output.
 * The ModelConfigService reads this file at runtime via fs.readFileSync.
 */
function copyModelsConfig(): Plugin {
  return {
    name: "copy-models-config",
    closeBundle() {
      const src = resolve(__dirname, "electron/main/config/models.config.json");
      const destDir = resolve(__dirname, "out/main/config");
      const dest = resolve(destDir, "models.config.json");
      if (existsSync(src)) {
        if (!existsSync(destDir)) {
          mkdirSync(destDir, { recursive: true });
        }
        copyFileSync(src, dest);
        console.log("[copy-models-config] Copied models.config.json to out/main/config/");
      }
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyModelsConfig()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "electron/main/index.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "electron/preload/index.ts"),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src"),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/index.html"),
          "mini-control-bar": resolve(__dirname, "src/mini-control-bar.html"),
        },
      },
    },
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
        "@components": resolve(__dirname, "src/components"),
        "@pages": resolve(__dirname, "src/pages"),
        "@hooks": resolve(__dirname, "src/hooks"),
        "@lib": resolve(__dirname, "src/lib"),
        "@store": resolve(__dirname, "src/store"),
        "@types": resolve(__dirname, "src/types"),
      },
    },
    plugins: [react()],
  },
});
