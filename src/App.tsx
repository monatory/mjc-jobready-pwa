import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import Start from "./student/Start";
import Survey from "./student/Survey";
import Diagnostic from "./student/Diagnostic";
import Result from "./student/Result";
import Dashboard from "./admin/Dashboard";
import CounselDesk from "./admin/CounselDesk";
import ErrorBoundary from "./components/ErrorBoundary";

export default function App() {
  return (
    <HashRouter>
      {/* 렌더 예외 시 백지 대신 안내 화면 (점검 C5) */}
      <ErrorBoundary>
      <Routes>
        <Route path="/" element={<Start />} />
        <Route path="/survey" element={<Survey />} />
        <Route path="/diagnostic" element={<Diagnostic />} />
        <Route path="/result" element={<Result />} />
        <Route path="/admin" element={<Dashboard />} />
        {/* 상담사 전용 히든 워크스페이스 — 어디에도 링크하지 않음, 상담사 계열 로그인 시 자동 진입 */}
        <Route path="/counsel" element={<CounselDesk />} />
        {/* 오타·구주소 해시가 백지 화면이 되지 않도록 시작 화면으로 (2026-09-02 점검 MISS-06) */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </ErrorBoundary>
    </HashRouter>
  );
}
