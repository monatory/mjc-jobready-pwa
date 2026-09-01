// 계정 관리 패널 — 역할군별 분리 (2026-08-30):
//  · 관리자 화면(#/admin, 마스터): 담당자(행정) 계정만  · 워크스페이스(#/counsel): 상담사 계정만
//  · Firebase 설정 후에는 ready_staff(클라우드) 목록이 우선, 실패 시 로컬 목록 폴백
import { useEffect, useState } from "react";
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
}: {
  title: string;
  description: string;
  roles: AdminRole[]; // 이 패널에서 보이는 역할군
  canPromote?: boolean; // 상담사 ↔ 상담사 관리자 전환 (마스터 전용)
}) {
  const [accounts, setAccounts] = useState<AdminAccount[]>(loadAccounts);
  const [cloudMode, setCloudMode] = useState(false);
  const [actMsg, setActMsg] = useState<string | null>(null);

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
  const act = async (a: AdminAccount, action: "approve" | "toggleActive" | "toggleLead" | "remove") => {
    setActMsg(null);
    if (cloudMode && a.uid) {
      let ok = false;
      if (action === "approve") ok = await approveStaffCloud(a.uid);
      if (action === "toggleActive") ok = await setStaffStatusCloud(a.uid, a.status === "ACTIVE" ? "DISABLED" : "ACTIVE");
      if (action === "toggleLead")
        ok = await setStaffLeadCloud(a.uid, a.role === "COUNSELOR" ? "COUNSELOR_LEAD" : "COUNSELOR");
      if (action === "remove") ok = await removeStaffCloud(a.uid);
      if (!ok) setActMsg("⚠ 처리에 실패했습니다 — 네트워크·권한(규칙 게시) 상태를 확인하고 다시 시도해 주세요.");
      await refreshCloud();
    } else {
      if (action === "approve") setAccounts(approveAccount(a.id));
      if (action === "toggleActive") setAccounts(toggleAccountActive(a.id));
      if (action === "toggleLead") setAccounts(toggleCounselorLead(a.id));
      if (action === "remove") setAccounts(removeAccount(a.id));
    }
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
      {actMsg && <p className="profile-edit__msg profile-edit__msg--err">{actMsg}</p>}
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
                      {canPromote && (a.role === "COUNSELOR" || a.role === "COUNSELOR_LEAD") && a.status === "ACTIVE" && (
                        <button className="btn btn--ghost btn--sm" onClick={() => void act(a, "toggleLead")}>
                          {a.role === "COUNSELOR" ? "관리자로 지정" : "관리자 해제"}
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
