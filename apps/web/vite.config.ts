import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.API_URL ?? "http://localhost:3000",
        changeOrigin: true,
      },
      // The MCP endpoint and the OAuth flow that guards it live on the API too.
      ...Object.fromEntries(
        ["/mcp", "/oauth", "/.well-known"].map((path) => [
          path,
          { target: process.env.API_URL ?? "http://localhost:3000" },
        ]),
      ),
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
