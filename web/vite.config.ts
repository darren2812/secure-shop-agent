import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: "localhost", // not the LAN; for a phone demo use `vite --host` on purpose (backend still checks the demo token)
    proxy: {
      // xfwd: the backend sees the real client address and keeps demo controls local
      "/api": { target: "http://localhost:8000", changeOrigin: true, xfwd: true },
    },
  },
});
