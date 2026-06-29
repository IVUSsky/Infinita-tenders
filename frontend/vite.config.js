import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// /api заявките се проксират към backend-а на :4010 (смени при нужда).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4010",
    },
  },
});
