import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 신규 독립 시스템 — MJC-CAT(포트 5173)과 충돌 방지를 위해 5174 사용
export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
});
