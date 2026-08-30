// 본인 비밀번호 변경 모달 — 관리자 화면·상담사 워크스페이스 공용
import { useState, type FormEvent } from "react";
import { changePassword } from "./auth";

export default function PasswordModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (newPw !== newPw2) {
      setMsg({ text: "새 비밀번호가 서로 일치하지 않습니다.", ok: false });
      return;
    }
    const r = await changePassword(userId, currentPw, newPw);
    setMsg({ text: r.message, ok: r.ok });
    if (r.ok) setTimeout(onClose, 800);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <h3>비밀번호 변경</h3>
        <form className="admin-login__form" onSubmit={submit}>
          <label className="adv-filter__field">
            <span>현재 비밀번호</span>
            <input className="input" type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} autoFocus />
          </label>
          <label className="adv-filter__field">
            <span>새 비밀번호 (8자 이상)</span>
            <input className="input" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          </label>
          <label className="adv-filter__field">
            <span>새 비밀번호 확인</span>
            <input className="input" type="password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} />
          </label>
          {msg && (
            <p className={`admin-login__msg ${msg.ok ? "admin-login__msg--ok" : "admin-login__msg--err"}`}>{msg.text}</p>
          )}
          <div className="modal__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>취소</button>
            <button className="btn btn--primary" disabled={!currentPw || !newPw}>변경</button>
          </div>
        </form>
      </div>
    </div>
  );
}
