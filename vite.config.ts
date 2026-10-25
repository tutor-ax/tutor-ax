import { defineConfig } from "vitest/config";

export default defineConfig({
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
  plugins: [
    {
      name: "local-development-websocket-only",
      apply: "serve",
      transformIndexHtml(html) {
        // Development may connect only to Vite's local HMR socket, never HTTP APIs.
        // Production build retains connect-src 'none'.
        return html.replace(
          "connect-src 'none'",
          "connect-src ws://127.0.0.1:5173 ws://localhost:5173",
        );
      },
    },
  ],
  test: {
    environment: "jsdom",
    setupFiles: "./tests/setup.ts",
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
