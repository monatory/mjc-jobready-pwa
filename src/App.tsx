import { HashRouter, Routes, Route } from "react-router-dom";
import Start from "./student/Start";
import Survey from "./student/Survey";
import Diagnostic from "./student/Diagnostic";
import Result from "./student/Result";
import Dashboard from "./admin/Dashboard";

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Start />} />
        <Route path="/survey" element={<Survey />} />
        <Route path="/diagnostic" element={<Diagnostic />} />
        <Route path="/result" element={<Result />} />
        <Route path="/admin" element={<Dashboard />} />
      </Routes>
    </HashRouter>
  );
}
