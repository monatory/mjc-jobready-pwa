// 계정 관리 패널 — 역할군별 분리 (2026-08-30):
//  · 관리자 화면(#/admin, 마스터): 담당자(행정) 계정만  · 워크스페이스(#/counsel): 상담사 계정만
//  · Firebase 설정 후에는 ready_staff(클라우드) 목록이 우선, 실패 시 로컬 목록 폴백
import { useEffect, useState, type FormEvent } from "react";
import {
  loadAccounts,
  approveAccount,
  toggleAccountActive,
  toggleCounselorLead,
  removeAccount,
  loadStaffCloud,
  approveStaffCloud,
  setStaffStatusCloud,
  setStaffLeadCloud,
  removeStaffCloud,
  createStaffCloud,
  createLocalAccount,
  setStaffRoleCloud,
  setAccountRole,
  leadCounterpart,
  ROLE_LABELS,
  STATUS_LABELS,
  type AdminAccount,
  type AdminRole,
} from "./auth";
import { CLOUD_ENABLED } from "../lib/firebase";

export default function Accounts({
  title,
  description,
  roles,
  canPromote = false,
  canCreate = false,
  reassignTo,
}: {
  title: string;
  description: string;
  roles: AdminRole[]; // 이 패널에서 보이는 역할군
  canPromote?: boolean; // 상담사 ↔ 상담사 관리자 전환 (마스터 전용)
  canCreate?: boolean; // 직접 등록 (마스터 전용 — Rules상 ACTIVE 생성은 마스터만)
  reassignTo?: AdminRole; // 잘못 접수된 계정을 옮길 반대편 구분 (마스터 전용)
}) {
  const [accounts, setAccounts] = useState<AdminAccount[]>(loadAccounts);
  const [cloudMode, setCloudMode] = useState(false);
  const [actMsg, setActMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // 직접 등록 폼 (2026-09-03) — 신청이 오지 않을 때의 우회 경로이자 상시 등록 수단
  const [openNew, setOpenNew] = useState(false);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [newDept, setNewDept] = useState("");
  const [newRole, setNewRole] = useState<AdminRole>(roles[0]);
  const [newPw, setNewPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [newMsg, setNewMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const refreshCloud = async () => {
    const cloud = await loadStaffCloud();
    if (cloud) {
      setAccounts(cloud);
      setCloudMode(true);
    }
  };
  useEffect(() => {
    void refreshCloud();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = accounts.filter((a) => roles.includes(a.role));
  const pending = visible.filter((a) => a.status === "PENDING").length;

  // 클라우드/로컬 공용 액션 디스패치 — 클라우드 실패는 반드시 표시 (감사 P3-10·C4-12),
  // 상태·역할은 토글이 아니라 화면이 계산한 "목표값"을 기록 (감사 F16: 동시 처리 시 의도 반전 방지)
  const act = async (
    a: AdminAccount,
    action: "approve" | "toggleActive" | "toggleLead" | "remove" | "reassign"
  ) => {
    setActMsg(null);
    if (cloudMode && a.uid) {
      let ok = false;
      if (action === "approve") ok = await approveStaffCloud(a.uid);
      if (action === "toggleActive") ok = await setStaffStatusCloud(a.uid, a.status === "ACTIVE" ? "DISABLED" : "ACTIVE");
      if (action === "toggleLead") {
        const next = leadCounterpart(a.role);
        ok = next ? await setStaffLeadCloud(a.uid, next) : false;
      }
      if (action === "remove") ok = await removeStaffCloud(a.uid);
      if (action === "reassign" && reassignTo) ok = await setStaffRoleCloud(a.uid, reassignTo);
      if (!ok)
        setActMsg({ text: "⚠ 처리에 실패했습니다 — 네트워크·권한(규칙 게시) 상태를 확인하고 다시 시도해 주세요.", ok: false });
      else if (action === "reassign" && reassignTo)
        setActMsg({
          text: `'${a.name}' 계정을 ${ROLE_LABELS[reassignTo]}(으)로 옮겼습니다 — 해당 계정 관리 화면에서 승인해 주세요.`,
          ok: true,
        });
      await refreshCloud();
    } else {
      if (action === "approve") setAccounts(approveAccount(a.id));
      if (action === "toggleActive") setAccounts(toggleAccountActive(a.id));
      if (action === "toggleLead") setAccounts(toggleCounselorLead(a.id));
      if (action === "remove") setAccounts(removeAccount(a.id));
      if (action === "reassign" && reassignTo) {
        setAccounts(setAccountRole(a.id, reassignTo));
        setActMsg({
          text: `'${a.name}' 계정을 ${ROLE_LABELS[reassignTo]}(으)로 옮겼습니다 — 해당 계정 관리 화면에서 승인해 주세요.`,
          ok: true,
        });
      }
    }
  };

  // 직접 등록 — 클라우드면 Auth 사용자+staff 문서(ACTIVE), 로컬이면 브라우저 계정 목록에 추가
  const submitNew = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNewMsg(null);
    const payload = { name: newName, dept: newDept, role: newRole, password: newPw };
    const r = cloudMode
      ? await createStaffCloud({ email: newId, ...payload })
      : await createLocalAccount({ id: newId, ...payload });
    setNewMsg({ text: r.message, ok: r.ok });
    if (r.ok) {
      setNewId("");
      setNewName("");
      setNewDept("");
      setNewPw("");
      if (cloudMode) await refreshCloud();
      else setAccounts(loadAccounts());
    }
    setBusy(false);
  };

  return (
    <>
      <h1 className="admin__title">{title}</h1>
      <p className="muted">
        {description} 승인 대기 <strong>{pending}건</strong>.
        {" "}
        {cloudMode
          ? "☁ 공유 저장소(Firebase) 연결됨 — 승인·변경이 모든 기기에 반영됩니다."
          : CLOUD_ENABLED
            ? "공유 저장소에 연결하지 못해 이 브라우저의 로컬 계정을 표시 중입니다."
            : "시범: 이 브라우저에만 저장되는 로컬 계정 — Firebase 설정(docs/FIREBASE_SETUP.md) 후 공유로 전환됩니다."}
      </p>
      {actMsg && (
        <p className={`profile-edit__msg ${actMsg.ok ? "" : "profile-edit__msg--err"}`}>{actMsg.text}</p>
      )}

      {/* 직접 등록 — 신청·승인을 기다리지 않고 바로 쓸 수 있는 계정을 만든다 (2026-09-03) */}
      {canCreate && (
        <div className="card acct-new">
          <button className="btn btn--ghost btn--sm" onClick={() => setOpenNew((v) => !v)}>
            {openNew ? "− 직접 등록 닫기" : "＋ 계정 직접 등록"}
          </button>
          {openNew && (
            <form className="acct-new__form" onSubmit={submitNew}>
              <p className="muted small">
                신청·승인 절차 없이 <strong>바로 사용 가능한 상태</strong>로 계정을 만듭니다.
                {cloudMode
                  ? " 아이디는 이메일이어야 하며, 비밀번호는 등록 후 본인이 변경할 수 있습니다."
                  : " 이 브라우저에만 저장되는 로컬 계정으로 등록됩니다."}
              </p>
              <div className="acct-new__grid">
                <label className="adv-filter__field">
                  <span>{cloudMode ? "아이디 (이메일)" : "아이디"}</span>
                  <input
                    className="input"
                    type={cloudMode ? "email" : "text"}
                    placeholder={cloudMode ? "예: hong@mjc.ac.kr" : "예: hong123"}
                    value={newId}
                    onChange={(e) => setNewId(e.target.value)}
                  />
                </label>
                <label className="adv-filter__field">
                  <span>이름</span>
                  <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} />
                </label>
                <label className="adv-filter__field">
                  <span>소속 (선택)</span>
                  <input
                    className="input"
                    placeholder="예: 잡카페"
                    value={newDept}
                    onChange={(e) => setNewDept(e.target.value)}
                  />
                </label>
                <label className="adv-filter__field">
                  <span>구분</span>
                  <select
                    className="input"
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as AdminRole)}
                  >
                    {roles.map((r) => (
                      <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                    ))}
                  </select>
                </label>
                <label className="adv-filter__field">
                  <span>초기 비밀번호 (8자 이상)</span>
                  <input
                    className="input"
                    type="password"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                  />
                </label>
              </div>
              <button
                className="btn btn--primary btn--sm"
                disabled={busy || !newId || !newName || newPw.length < 8}
              >
                {busy ? "등록 중…" : "계정 등록"}
              </button>
              {newMsg && (
                <p className={`profile-edit__msg ${newMsg.ok ? "" : "profile-edit__msg--err"}`}>
                  {newMsg.text}
                </p>
              )}
            </form>
          )}
        </div>
      )}

      <div className="table-wrap card">
        <table className="admin-table">
          <thead>
            <tr>
              <th>아이디</th><th>이름</th><th>소속</th><th>구분</th><th>상태</th><th>신청일</th><th>처리</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={7} className="muted">해당하는 계정이 아직 없습니다.</td></tr>
            )}
            {visible.map((a) => (
              <tr key={a.uid ?? a.id} className={a.status === "DISABLED" ? "row-off" : ""}>
                <td className="code">{a.id}</td>
                <td><strong>{a.name}</strong></td>
                <td>{a.dept || "—"}</td>
                <td>{ROLE_LABELS[a.role]}</td>
                <td>
                  <span className={`acct-status acct-status--${a.status.toLowerCase()}`}>{STATUS_LABELS[a.status]}</span>
                </td>
                <td className="small">{a.created_at.slice(0, 10)}</td>
                <td>
                  {a.role === "MASTER" ? (
                    <span className="muted small">내장 계정</span>
                  ) : (
                    <div className="acct-actions">
                      {a.status === "PENDING" && (
                        <button className="btn btn--primary btn--sm" onClick={() => void act(a, "approve")}>
                          승인
                        </button>
                      )}
                      {a.status !== "PENDING" && (
                        <button className="btn btn--ghost btn--sm" onClick={() => void act(a, "toggleActive")}>
                          {a.status === "ACTIVE" ? "비활성" : "활성"}
                        </button>
                      )}
                      {/* 관리자 임명·해제 — 상담사↔상담사 관리자, 담당자↔담당자 관리자 (2026-09-03) */}
                      {canPromote && leadCounterpart(a.role) && a.status === "ACTIVE" && (
                        <button className="btn btn--ghost btn--sm" onClick={() => void act(a, "toggleLead")}>
                          {a.role === "COUNSELOR" || a.role === "ADMIN" ? "관리자로 지정" : "관리자 해제"}
                        </button>
                      )}
                      {/* 구분 이동 — 신청이 반대편 대기열에 접수됐을 때 삭제·재신청 없이 옮긴다 (2026-09-03) */}
                      {reassignTo && (
                        <button
                          className="btn btn--ghost btn--sm"
                          title={`이 계정을 ${ROLE_LABELS[reassignTo]} 목록으로 옮깁니다`}
                          onClick={() => {
                            if (window.confirm(`'${a.name}(${a.id})' 계정을 ${ROLE_LABELS[reassignTo]}(으)로 옮길까요?`))
                              void act(a, "reassign");
                          }}
                        >
                          {ROLE_LABELS[reassignTo]}로 변경
                        </button>
                      )}
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => {
                          if (window.confirm(`'${a.name}(${a.id})' 계정을 삭제할까요?`)) void act(a, "remove");
                        }}
                      >
                        삭제
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
