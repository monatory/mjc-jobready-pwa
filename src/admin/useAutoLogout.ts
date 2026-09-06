// 자동 로그아웃 훅 — 로그인 후 6시간(auth.SESSION_MAX_MS)이 지나면 어떤 역할이든 로그인 화면으로 (2026-09-06 사용자 결정).
// 1분마다 확인하고, 탭이 다시 보이거나 창이 포커스를 받을 때도 확인한다 — PC가 절전에서 깨어나 타이머가 밀린 경우도
// 복귀 즉시 적용된다. 관리자 화면(Dashboard)·상담사 워크스페이스(CounselDesk)가 함께 쓴다.
import { useEffect, useRef } from "react";
import { autoLogout, isSessionExpired, type AdminSession } from "./auth";

export function useAutoLogout(session: AdminSession | null, onLogout: () => void): void {
  // 콜백은 렌더마다 새 함수라 ref로 잡아 둔다 — effect(타이머·리스너)는 세션이 바뀔 때만 다시 건다
  const onLogoutRef = useRef(onLogout);
  onLogoutRef.current = onLogout;
  useEffect(() => {
    if (!session) return;
    const check = () => {
      if (!isSessionExpired(session)) return;
      autoLogout("EXPIRED");
      onLogoutRef.current();
    };
    check();
    const timer = window.setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [session]);
}
