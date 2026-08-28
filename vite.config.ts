import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages(개발기 미리보기) 배포 시 하위 경로 대응.
// CI(GitHub Actions)에서 자동 적용; 로컬 dev에서는 "/" 유지.
// 본 운영 시 학내 도메인(루트)으로 옮길 때는 워크플로 비활성하면 됨. (MJC-CAT §14 패턴 승계)
const IS_PAGES_BUILD =
  process.env.GITHUB_ACTIONS === "true" || process.env.GITHUB_PAGES === "1";
const BASE = IS_PAGES_BUILD ? "/mjc-jobready-pwa/" : "/";

// 신규 독립 시스템 — MJC-CAT(포트 5173)과 충돌 방지를 위해 5174 사용
export default defineConfig({
  base: BASE,
  plugins: [react()],
  server: { port: 5174 },
});
