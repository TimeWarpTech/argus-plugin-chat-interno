import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  build: {
    lib: { entry: "src/ui.tsx", formats: ["es"], fileName: () => "ui.js" },
    // React fica de fora: duas cópias na mesma página sao dois reconciliadores com estado separado.
    // O host resolve estes nomes pelo import map.
    rollupOptions: { external: ["react", "react-dom", "react/jsx-runtime"] },
    cssCodeSplit: false,
    outDir: "dist",
    emptyOutDir: true,
  },
});
