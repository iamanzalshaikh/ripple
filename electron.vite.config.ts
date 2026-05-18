import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin, loadEnv } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiUrl = env.VITE_API_URL ?? "http://127.0.0.1:3007/api/v1";

  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      define: {
        "process.env.VITE_API_URL": JSON.stringify(apiUrl),
      },
      build: {
        rollupOptions: {
          input: resolve(__dirname, "electron/main/index.ts"),
        },
      },
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      build: {
        rollupOptions: {
          input: resolve(__dirname, "electron/preload/index.ts"),
        },
      },
    },
    renderer: {
      root: resolve(__dirname),
      build: {
        rollupOptions: {
          input: resolve(__dirname, "index.html"),
        },
      },
      resolve: {
        alias: {
          "@renderer": resolve("src"),
        },
      },
      plugins: [react(), tailwindcss()],
    },
  };
});
