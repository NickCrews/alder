import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: {
      external: ["solid-js", "solid-js/web", "solid-js/store"],
    },
  },
  resolve: {
    // Needed so solid-js resolves its browser build under vitest/jsdom.
    conditions: ["browser", "development"],
  },
  test: {
    environment: "node",
    server: { deps: { inline: [/solid-js/] } },
  },
});
