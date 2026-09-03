// 본인 비밀번호 변경 모달 — 관리자 화면·상담사 워크스페이스 공용
import { useState, type FormEvent } from "react";
import { changePassword, sendResetMail } from "./auth";
import { CLOUD_ENABLED } from "../lib/firebase";

export default function PasswordModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  // 클라우드(Firebase Auth) 계정은 비밀번호를 여기서 바꿀 수 없고 재설정 메일로만 바꾼다.
  // 예전엔 현재·새 비밀번호를 입력받아 놓고 무시한 채 메일만 보내 혼란을 줬다 (2026-09-02 점검 A10/C12)
  const cloudAccount = CLOUD_ENABLED && userId.includes("@");

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

  const sendMail = async () => {
    setBusy(true);
    const r = await sendResetMail(userId);
    setBusy(false);
    setMsg({ text: r.message, ok: r.ok });
  };

  if (cloudAccount)
    return (
      <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="비밀번호 재설정">
        <div className="modal card" onClick={(e) => e.stopPropagation()}>
          <h3>비밀번호 재설정</h3>
          <p>
            학교 공용 계정의 비밀번호는 <strong>재설정 메일</strong>로 바꿉니다. 아래 버튼을 누르면
            <strong> {userId}</strong>로 메일이 발송되며, 메일의 링크에서 새 비밀번호를 정하면 바로 적용됩니다.
          </p>
          {msg && (
            <p className={`admin-login__msg ${msg.ok ? "admin-login__msg--ok" : "admin-login__msg--err"}`}>{msg.text}</p>
          )}
          <div className="modal__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>닫기</button>
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void sendMail()}>
              {busy ? "발송 중…" : "재설정 메일 보내기"}
            </button>
          </div>
        </div>
      </div>
    );

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="비밀번호 변경">
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
