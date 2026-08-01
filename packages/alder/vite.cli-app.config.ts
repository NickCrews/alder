import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/** The page `alder <dir>` serves: one self-contained index.html next to the
 * CLI bundle, which reads it off disk at request time. */
export default defineConfig({
  root: "cli/app",
  plugins: [solid(), tailwindcss(), viteSingleFile()],
  build: {
    target: "esnext",
    outDir: "../../dist/cli",
    emptyOutDir: false,
  },
});
