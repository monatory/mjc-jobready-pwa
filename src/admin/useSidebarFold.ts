// 사이드바 접기 — 명단(최대 15열)이 좁은 화면에서도 가로 스크롤 없이 한 화면에 들어오게 (2026-09-02).
// 사이드바 210px + 여백을 회수하면 1280px 노트북에서도 전 컬럼이 보인다.
// 선택은 브라우저에 기억(localStorage) — 상담사가 매번 다시 접지 않도록.
import { useCallback, useEffect, useState } from "react";

const KEY = "mjc_ready_side_folded";

export function useSidebarFold(): [boolean, () => void] {
  const [folded, setFolded] = useState<boolean>(() => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false; // 저장소 차단(사생활 모드 등) — 기본 펼침
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(KEY, folded ? "1" : "0");
    } catch {
      /* 기억 실패는 치명적이지 않음 — 이번 세션에만 적용 */
    }
  }, [folded]);

  const toggle = useCallback(() => setFolded((v) => !v), []);
  return [folded, toggle];
}
