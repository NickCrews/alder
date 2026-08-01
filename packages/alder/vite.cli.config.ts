import { defineConfig } from "vite";

/** The node entry point behind `npx @nickcrews/alder`. Bundled so the
 * published package needs no runtime dependencies. */
export default defineConfig({
  build: {
    ssr: "cli/main.ts",
    target: "node20",
    outDir: "dist/cli",
    emptyOutDir: false,
    rollupOptions: {
      output: {
        entryFileNames: "alder.js",
        format: "es",
        banner: "#!/usr/bin/env node",
      },
    },
  },
});
