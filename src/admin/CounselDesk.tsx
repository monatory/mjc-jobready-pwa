// 상담사 워크스페이스(#/counsel) — 비공개 히든 페이지 (2026-08-30 사용자 확정).
//  · 접근: 마스터(개발자) + 상담사 관리자 + 상담사만. 담당자(행정)는 접근 시 #/admin으로 돌려보냄.
//  · 내용: 연락 우선 큐·연락 기록(상태+메모) 공유 관리 + (상담사 관리자) 상담사 계정 등록·관리.
//  · 어떤 화면 링크에도 노출하지 않는다 — 상담사 계열 로그인 시에만 자동 진입.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { mockStudents } from "./mockStudents";
import { getSession, logout, canAccess, isCounselSide, homeRoute, ROLE_LABELS, type AdminSession } from "./auth";
import AdminLogin from "./Login";
import Accounts from "./Accounts";
import PasswordModal from "./PasswordModal";
import StudentsPanel, { needsOutreachWith } from "./StudentsPanel";
import AgencyManager from "./AgencyManager";
import { loadOutreach, referralStageOf } from "./outreach";

type Section = "students" | "agencies" | "counselors";
const SECTION_PERMS: Record<Section, string> = {
  students: "counselStudents",
  agencies: "counselAgencies",
  counselors: "counselAccounts",
};

export default function CounselDesk() {
  const navigate = useNavigate();
  const [session, setSession] = useState<AdminSession | null>(getSession);
  const [pwModal, setPwModal] = useState(false);
  const [section, setSection] = useState<Section>("students");

  // 담당자(행정)는 이 페이지를 볼 수 없다 — 관리자 화면으로 돌려보냄 (핵심 요구)
  useEffect(() => {
    if (session && !isCounselSide(session.role)) navigate("/admin", { replace: true });
  }, [session, navigate]);

  // 헤더에 보여줄 오늘의 업무량 (연락 대기 · 연계 사후관리)
  const { waitCount, followupCount } = useMemo(() => {
    const outreach = loadOutreach();
    return {
      waitCount: mockStudents.filter(needsOutreachWith(outreach)).length,
      followupCount: mockStudents.filter((s) =>
        ["REFERRED", "FOLLOWUP"].includes(referralStageOf(outreach, s.student_id))
      ).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  if (!session)
    return (
      <AdminLogin
        onLogin={(s) => {
          setSession(s);
          navigate(homeRoute(s.role), { replace: true });
        }}
      />
    );

  if (!isCounselSide(session.role)) return null; // 리다이렉트 대기 중 빈 화면

  const sections = (
    [
      ["students", "연락·상담 관리 (명단)"],
      ["agencies", "연계기관·취업처 관리"],
      ["counselors", "상담사 계정 관리"],
    ] as Array<[Section, string]>
  ).filter(([key]) => canAccess(session.role, SECTION_PERMS[key]));

  return (
    <div className="admin admin--counsel">
      <aside className="admin__side">
        <div className="admin__brand">
          <span className="app-header__logo">MJC</span>
          <div>
            <strong>잡카페 상담사 워크스페이스</strong>
            <span>비공개 — 상담사 전용</span>
          </div>
        </div>
        <nav className="admin__nav">
          {sections.map(([key, label]) => (
            <button
              key={key}
              className={`admin__nav-item ${section === key ? "admin__nav-item--on" : ""}`}
              onClick={() => setSection(key)}
            >
              {label}
            </button>
          ))}
          {session.role === "MASTER" && (
            <button className="admin__nav-item admin__nav-item--counsel" onClick={() => navigate("/admin")}>
              ← 관리자 화면
            </button>
          )}
        </nav>
        <div className="admin__user">
          <strong>{session.name}</strong>
          <span>{ROLE_LABELS[session.role]}</span>
          <div className="admin__user-actions">
            {/* 마스터 비밀번호는 코드 고정 — 변경 버튼 비노출 */}
            {session.role !== "MASTER" && (
              <button className="btn btn--ghost btn--sm" onClick={() => setPwModal(true)}>비밀번호 변경</button>
            )}
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => { logout(); setSession(null); setSection("students"); }}
            >
              로그아웃
            </button>
          </div>
        </div>
        <button className="admin__back" onClick={() => navigate("/")}>← 학생 화면으로</button>
      </aside>

      <main className="admin__main">
        <div className="admin__banner admin__banner--counsel">
          상담사 전용 공간 — 연락 기록·상담 메모는 이곳에서만 보이며, 담당자(행정) 화면과 일반 다운로드에는 포함되지 않습니다.
          시범: 이 브라우저에만 저장 — 상담사 간 실시간 공유는 Firestore 연동 시 활성화됩니다.
        </div>

        {section === "students" && (
          <>
            <h1 className="admin__title">
              연락·상담 관리{" "}
              <span className="muted small">연락 대기 {waitCount}명 · 연계 사후관리 {followupCount}명</span>
            </h1>
            <StudentsPanel session={session} showOutreach={true} />
          </>
        )}

        {section === "agencies" && canAccess(session.role, "counselAgencies") && <AgencyManager />}

        {section === "counselors" && canAccess(session.role, "counselAccounts") && (
          <Accounts
            title="상담사 계정 관리"
            description="상담사 가입 신청을 승인하거나 사용을 중지·삭제합니다. 상담사 관리자 지정·해제는 마스터만 할 수 있습니다."
            roles={["COUNSELOR_LEAD", "COUNSELOR"]}
            canPromote={session.role === "MASTER"}
          />
        )}
      </main>

      {pwModal && <PasswordModal userId={session.id} onClose={() => setPwModal(false)} />}
    </div>
  );
}
