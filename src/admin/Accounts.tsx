// 계정 관리 패널 — 역할군별로 분리 사용 (2026-08-30 사용자 확정):
//  · 관리자 화면(#/admin, 마스터 전용): 담당자(행정) 계정만 관리
//  · 상담사 워크스페이스(#/counsel, 상담사 관리자+마스터): 상담사 계정만 관리
//  → 담당자(행정)는 상담사 명단·계정을 볼 수 없다.
import { useState } from "react";
import {
  loadAccounts,
  approveAccount,
  toggleAccountActive,
  toggleCounselorLead,
  removeAccount,
  ROLE_LABELS,
  STATUS_LABELS,
  type AdminAccount,
  type AdminRole,
} from "./auth";

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
  const visible = accounts.filter((a) => roles.includes(a.role));
  const pending = visible.filter((a) => a.status === "PENDING").length;

  return (
    <>
      <h1 className="admin__title">{title}</h1>
      <p className="muted">
        {description} 승인 대기 <strong>{pending}건</strong>.
        {" "}시범: 이 브라우저에만 저장되는 로컬 계정 — 본 구현 시 Firebase Auth·권한 문서로 교체.
      </p>
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
              <tr key={a.id} className={a.status === "DISABLED" ? "row-off" : ""}>
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
                        <button className="btn btn--primary btn--sm" onClick={() => setAccounts(approveAccount(a.id))}>
                          승인
                        </button>
                      )}
                      {a.status !== "PENDING" && (
                        <button className="btn btn--ghost btn--sm" onClick={() => setAccounts(toggleAccountActive(a.id))}>
                          {a.status === "ACTIVE" ? "비활성" : "활성"}
                        </button>
                      )}
                      {canPromote && (a.role === "COUNSELOR" || a.role === "COUNSELOR_LEAD") && a.status === "ACTIVE" && (
                        <button className="btn btn--ghost btn--sm" onClick={() => setAccounts(toggleCounselorLead(a.id))}>
                          {a.role === "COUNSELOR" ? "관리자로 지정" : "관리자 해제"}
                        </button>
                      )}
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => {
                          if (window.confirm(`'${a.name}(${a.id})' 계정을 삭제할까요?`)) setAccounts(removeAccount(a.id));
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
