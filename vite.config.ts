import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

// `scripts/dev.mjs` picks a free port and passes it here, then points Tauri's
// `devUrl` at the same one. Standalone `npm run dev` has no such env var and
// keeps the historical port.
const devPort = Number(process.env.GLIMMERX_DEV_PORT) || 11422;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  clearScreen: false,
  server: {
    port: devPort,
    // Launched by `scripts/dev.mjs`: the port was verified free a moment ago,
    // so a collision now would mean `devUrl` points at nothing — fail loudly.
    // Standalone: take the next free port instead of refusing to start.
    strictPort: Boolean(process.env.GLIMMERX_DEV_PORT),
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
