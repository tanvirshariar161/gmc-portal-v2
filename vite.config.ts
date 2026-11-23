import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Version 2 runs beside version 1 (port 5174), so it takes 5175.
export default defineConfig({
  plugins: [react()],
  server: { port: 5175, strictPort: true },
  preview: { port: 4175 }
});
