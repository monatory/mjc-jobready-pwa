import { HashRouter, Routes, Route } from "react-router-dom";
import Start from "./student/Start";
import Survey from "./student/Survey";
import Diagnostic from "./student/Diagnostic";
import Result from "./student/Result";
import Dashboard from "./admin/Dashboard";
import CounselDesk from "./admin/CounselDesk";

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Start />} />
        <Route path="/survey" element={<Survey />} />
        <Route path="/diagnostic" element={<Diagnostic />} />
        <Route path="/result" element={<Result />} />
        <Route path="/admin" element={<Dashboard />} />
        {/* 상담사 전용 히든 워크스페이스 — 어디에도 링크하지 않음, 상담사 계열 로그인 시 자동 진입 */}
        <Route path="/counsel" element={<CounselDesk />} />
      </Routes>
    </HashRouter>
  );
}
