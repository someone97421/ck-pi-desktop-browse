import { defineConfig } from "vite"
import { fileURLToPath } from "node:url"

export default defineConfig(({ mode }) => ({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "chrome130",
    minify: mode !== "development",
    sourcemap: mode === "development" ? "inline" : false,
    lib: {
      entry: fileURLToPath(new URL("./src/content/element-picker.ts", import.meta.url)),
      formats: ["iife"],
      name: "agentElementPicker",
      fileName: () => "element-picker.js",
    },
  },
}))
