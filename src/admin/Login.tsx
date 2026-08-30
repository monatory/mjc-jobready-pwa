// 관리자 로그인·계정 신청 화면 — 시범 프로토타입(로컬 저장소 인증, auth.ts 주석 참조)
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ensureMasterAccount, login, registerAccount, ROLE_LABELS, type AdminSession } from "./auth";

type Tab = "login" | "register";

export default function AdminLogin({ onLogin }: { onLogin: (session: AdminSession) => void }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("login");
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  // 로그인 입력
  const [loginId, setLoginId] = useState("");
  const [loginPw, setLoginPw] = useState("");

  // 가입 신청 입력
  const [regRole, setRegRole] = useState<"ADMIN" | "COUNSELOR">("COUNSELOR");
  const [regName, setRegName] = useState("");
  const [regDept, setRegDept] = useState("");
  const [regId, setRegId] = useState("");
  const [regPw, setRegPw] = useState("");
  const [regPw2, setRegPw2] = useState("");

  useEffect(() => {
    void ensureMasterAccount(); // 마스터 내장 계정 준비 (최초 실행 대비)
  }, []);

  const submitLogin = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await login(loginId, loginPw);
    setBusy(false);
    if (r.ok && r.session) onLogin(r.session);
    else setMessage({ text: r.message, ok: false });
  };

  const submitRegister = async (e: FormEvent) => {
    e.preventDefault();
    if (regPw !== regPw2) {
      setMessage({ text: "비밀번호가 서로 일치하지 않습니다.", ok: false });
      return;
    }
    setBusy(true);
    const r = await registerAccount({ id: regId, name: regName, dept: regDept, role: regRole, password: regPw });
    setBusy(false);
    setMessage({ text: r.message, ok: r.ok });
    if (r.ok) {
      setTab("login");
      setLoginId(regId);
      setRegName(""); setRegDept(""); setRegId(""); setRegPw(""); setRegPw2("");
    }
  };

  return (
    <div className="admin-login">
      <div className="card admin-login__card">
        <div className="admin__brand admin-login__brand">
          <span className="app-header__logo">MJC</span>
          <div>
            <strong>MJC-READY 관리자</strong>
            <span>학생지원처 취·창업팀</span>
          </div>
        </div>

        <div className="admin-login__tabs">
          <button
            className={`chip ${tab === "login" ? "chip--on" : ""}`}
            onClick={() => { setTab("login"); setMessage(null); }}
          >
            로그인
          </button>
          <button
            className={`chip ${tab === "register" ? "chip--on" : ""}`}
            onClick={() => { setTab("register"); setMessage(null); }}
          >
            계정 신청 (담당자·상담사)
          </button>
        </div>

        {tab === "login" && (
          <form className="admin-login__form" onSubmit={submitLogin}>
            <label className="adv-filter__field">
              <span>아이디</span>
              <input className="input" value={loginId} onChange={(e) => setLoginId(e.target.value)} autoFocus />
            </label>
            <label className="adv-filter__field">
              <span>비밀번호</span>
              <input className="input" type="password" value={loginPw} onChange={(e) => setLoginPw(e.target.value)} />
            </label>
            <button className="btn btn--primary btn--block" disabled={busy || !loginId || !loginPw}>
              로그인
            </button>
            <p className="muted small">
              담당자(행정)·상담사는 계정 신청 후 승인을 받으면 로그인할 수 있습니다.
              로그인하면 각자의 화면으로 이동합니다.
            </p>
          </form>
        )}

        {tab === "register" && (
          <form className="admin-login__form" onSubmit={submitRegister}>
            <label className="adv-filter__field">
              <span>구분</span>
              <select className="input" value={regRole} onChange={(e) => setRegRole(e.target.value as "ADMIN" | "COUNSELOR")}>
                <option value="COUNSELOR">{ROLE_LABELS.COUNSELOR} (잡카페 진로·취업컨설턴트)</option>
                <option value="ADMIN">{ROLE_LABELS.ADMIN} (취·창업팀 실무자)</option>
              </select>
              <p className="muted small">
                상담사 계정은 상담사 관리자가, 담당자 계정은 마스터가 승인합니다.
              </p>
            </label>
            <label className="adv-filter__field">
              <span>이름</span>
              <input className="input" value={regName} onChange={(e) => setRegName(e.target.value)} />
            </label>
            <label className="adv-filter__field">
              <span>소속 (선택)</span>
              <input className="input" placeholder="예: 잡카페" value={regDept} onChange={(e) => setRegDept(e.target.value)} />
            </label>
            <label className="adv-filter__field">
              <span>아이디 (영문 소문자·숫자 4~20자)</span>
              <input className="input" value={regId} onChange={(e) => setRegId(e.target.value)} />
            </label>
            <label className="adv-filter__field">
              <span>비밀번호 (8자 이상)</span>
              <input className="input" type="password" value={regPw} onChange={(e) => setRegPw(e.target.value)} />
            </label>
            <label className="adv-filter__field">
              <span>비밀번호 확인</span>
              <input className="input" type="password" value={regPw2} onChange={(e) => setRegPw2(e.target.value)} />
            </label>
            <button className="btn btn--primary btn--block" disabled={busy || !regId || !regName || !regPw}>
              계정 신청
            </button>
            <p className="muted small">신청 즉시 사용은 불가하며, 마스터 관리자가 승인하면 로그인할 수 있습니다.</p>
          </form>
        )}

        {message && (
          <p className={`admin-login__msg ${message.ok ? "admin-login__msg--ok" : "admin-login__msg--err"}`}>
            {message.text}
          </p>
        )}

        <button className="btn btn--ghost btn--block" onClick={() => navigate("/")}>← 학생 화면으로</button>
      </div>
    </div>
  );
}
