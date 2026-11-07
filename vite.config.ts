import { defineConfig } from "vitest/config";

export default defineConfig({
  base: process.env.PAGES_BUILD === "true" ? "/tutor-ax/" : "/",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // 개발 중 관리자 API는 로컬 Spring Boot(backend/)로 넘긴다. 같은 출처라 CSP connect-src 'self'로 충분하다.
    proxy: { "/api/admin": "http://127.0.0.1:8080" },
  },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
  plugins: [
    {
      name: "pages-admin-entry",
      apply: "build",
      enforce: "post",
      generateBundle(_options, bundle) {
        if (process.env.PAGES_BUILD !== "true") return;
        const entry = bundle["index.html"];
        if (!entry || entry.type !== "asset")
          throw new Error("Missing built HTML entry");
        this.emitFile({
          type: "asset",
          fileName: "admin/index.html",
          source: entry.source,
        });
        this.emitFile({
          type: "asset",
          fileName: "admin.html",
          source:
            '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=./admin/"><title>Tutor AX 관리자 데모</title></head><body><a href="./admin/">관리자 데모 열기</a></body></html>',
        });
      },
    },
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
