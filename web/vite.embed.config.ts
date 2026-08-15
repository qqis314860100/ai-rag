import { defineConfig } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    outDir: "dist-embed",
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, "src/embed/ask-widget.ts"),
      name: "AiRagAskWidget",
      formats: ["iife"],
      fileName: () => "ai-rag-ask-widget.js",
    },
  },
});

