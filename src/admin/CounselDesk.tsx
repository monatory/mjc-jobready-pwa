// 상담사 워크스페이스(#/counsel) — 비공개 히든 페이지 (2026-08-30 사용자 확정).
//  · 접근: 마스터(개발자) + 상담사 관리자 + 상담사만. 담당자(행정)는 접근 시 #/admin으로 돌려보냄.
//  · 내용: 연락 우선 큐·연락 기록(상태+메모) 공유 관리 + (상담사 관리자) 상담사 계정 등록·관리.
//  · 어떤 화면 링크에도 노출하지 않는다 — 상담사 계열 로그인 시에만 자동 진입.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStudents, invalidateStudentsCache } from "./responsesSource";
import { pullShared, type CloudState } from "./cloudStore";
import { CLOUD_ENABLED } from "../lib/firebase";
import { getSession, logout, canAccess, isCounselSide, homeRoute, onCloudSignedOut, ROLE_LABELS, type AdminSession } from "./auth";
import AdminLogin from "./Login";
import Accounts from "./Accounts";
import PasswordModal from "./PasswordModal";
import StudentsPanel, { needsOutreachWith } from "./StudentsPanel";
import AgencyManager from "./AgencyManager";
import { loadOutreach, onOutreachChange, referralStageOf } from "./outreach";
import { useSidebarFold } from "./useSidebarFold";

type Section = "students" | "agencies" | "counselors";
const SECTION_PERMS: Record<Section, string> = {
  students: "counselStudents",
  agencies: "counselAgencies",
  counselors: "counselAccounts",
};

export default function CounselDesk() {
  const navigate = useNavigate();
  const [session, setSession] = useState<AdminSession | null>(getSession);
  // 로그인 게이트 통과 후에만 실명 응답을 조회 (점검 SEC-02)
  const { students, source, skipped, recoStale } = useStudents(Boolean(session)); // 클라우드 모드 = 실측만 (mock 위장 금지 — 감사 C4-09)
  const [pwModal, setPwModal] = useState(false);
  const [section, setSection] = useState<Section>("students");
  const [folded, toggleFold] = useSidebarFold();
  // null = 연결 확인 중 — 초기값을 "LOCAL"로 두면 로그인 직후 매번 "이 브라우저에만 보관" 경고가 먼저
  // 떴다가 사라졌다 (점검 C7)
  const [cloudState, setCloudState] = useState<CloudState | null>(CLOUD_ENABLED ? null : "LOCAL");
  // 상담 기록 변경 통지 구독 — 저장·동기화 후 헤더 카운트가 즉시 갱신 (감사 C4-11)
  const [outreachVersion, setOutreachVersion] = useState(0);
  useEffect(() => onOutreachChange(() => setOutreachVersion((v) => v + 1)), []);
  // 다른 탭·기기에서 로그아웃돼 Firebase 세션이 끊기면 이 탭도 로그인 화면으로 (점검 A11/C8)
  useEffect(
    () =>
      onCloudSignedOut(() => {
        logout();
        setSession(null);
      }),
    []
  );

  // 담당자(행정)는 이 페이지를 볼 수 없다 — 관리자 화면으로 돌려보냄 (핵심 요구)
  useEffect(() => {
    if (session && !isCounselSide(session.role)) navigate("/admin", { replace: true });
  }, [session, navigate]);

  // 공유 저장소에서 연락 기록·등록부 당겨오기 (설정 전에는 로컬 모드 유지)
  useEffect(() => {
    if (session && isCounselSide(session.role)) void pullShared().then(setCloudState);
  }, [session]);

  // 헤더에 보여줄 오늘의 업무량 (연락 대기 · 연계 사후관리) — 기록 저장·동기화 시 즉시 재계산
  const { waitCount, followupCount } = useMemo(() => {
    const outreach = loadOutreach();
    return {
      waitCount: students.filter(needsOutreachWith(outreach)).length,
      followupCount: students.filter((s) =>
        ["REFERRED", "FOLLOWUP"].includes(referralStageOf(outreach, s.student_id))
      ).length,
    };
  }, [students, outreachVersion]);

  if (!session)
    return (
      <AdminLogin
        onLogin={(s) => {
          setSession(s);
          // 상담사 계열(마스터 포함)은 지금 있는 워크스페이스에 그대로 — 마스터가 #/counsel에서
          // 로그인했는데 #/admin으로 튕기던 문제 수정 (감사 C4-14). 담당자만 관리자 화면으로.
          if (!isCounselSide(s.role)) navigate(homeRoute(s.role), { replace: true });
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
    <div className={`admin admin--counsel ${folded ? "admin--folded" : ""}`}>
      <aside className="admin__side">
        <div className="admin__brand">
          <span className="app-header__logo">MJC</span>
          <div>
            {/* 좁은 사이드바에서 줄바꿈으로 깨지지 않게 짧은 이름 사용 (2026-08-31) */}
            <strong>잡카페 워크스페이스</strong>
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
              onClick={() => {
                logout();
                setSession(null);
                setSection("students");
                setCloudState(CLOUD_ENABLED ? null : "LOCAL"); // 재로그인 직후 직전 세션의 연결 상태가 먼저 보이던 것 (점검 M11)
              }}
            >
              로그아웃
            </button>
          </div>
        </div>
        <button className="admin__back" onClick={() => navigate("/")}>← 학생 화면으로</button>
        {/* 명단(최대 15열)을 한 화면에 담기 위한 메뉴 접기 — 선택은 브라우저에 기억됨 (2026-09-02) */}
        <button className="admin__fold" onClick={toggleFold} title="메뉴를 접어 명단을 넓게 봅니다">
          ◀ 메뉴 접기
        </button>
      </aside>

      <main className="admin__main">
        {folded && (
          <button className="admin__unfold" onClick={toggleFold} title="메뉴 다시 보기">
            ☰ 메뉴
          </button>
        )}
        <div className="admin__banner admin__banner--counsel">
          상담사 전용 공간 — 연락 기록·상담 메모는 이곳에서만 보이며, 담당자(행정) 화면과 일반 다운로드에는 포함되지 않습니다.{" "}
          {cloudState === null
            ? "공유 저장소 연결 확인 중…"
            : cloudState === "CLOUD"
              ? "☁ 공유 저장소 연결됨 — 기록이 상담사 간에 공유됩니다."
              : "⚠ 공유 저장소 미연결(네트워크·권한·설정 확인) — 지금 저장하는 기록은 이 브라우저에만 보관되며 다른 상담사에게 공유되지 않습니다."}{" "}
          {source === "CLOUD" && `(실측 응답 ${students.length}건${skipped ? ` · 형식 오류 제외 ${skipped}건` : ""})`}
          {source === "CLOUD" && recoStale && " ⚠ 추천활동 목록을 최신으로 받지 못해 추천은 기본 목록 기준입니다 — 새로고침해 주세요."}
          {source === "ERROR" && "⚠ 학생 응답 조회 실패 — 명단이 비어 보이면 아래 새로고침을 누르거나 네트워크·로그인 상태를 확인하세요."}
        </div>

        {section === "students" && (
          <>
            <h1 className="admin__title">
              연락·상담 관리{" "}
              <span className="muted small">연락 대기 {waitCount}명 · 연계 사후관리 {followupCount}명</span>
              <button
                className="btn btn--ghost btn--sm"
                title="학생 응답·공유 기록을 다시 불러옵니다"
                onClick={() => {
                  invalidateStudentsCache();
                  void pullShared().then(setCloudState);
                }}
              >
                ↻ 새로고침
              </button>
            </h1>
            <StudentsPanel session={session} showOutreach={true} />
          </>
        )}

        {section === "agencies" && canAccess(session.role, "counselAgencies") && <AgencyManager />}

        {section === "counselors" && canAccess(session.role, "counselAccounts") && (
          <Accounts
            title="상담사 계정 관리"
            description="상담사 가입 신청을 승인하거나 사용을 중지·삭제합니다. 상담사 관리자 지정·해제와 직접 등록은 마스터만 할 수 있습니다."
            roles={["COUNSELOR_LEAD", "COUNSELOR"]}
            canPromote={session.role === "MASTER"}
            canCreate={session.role === "MASTER"}
            // 담당자(행정) 신청이 상담사 대기열로 접수된 경우 여기서 되돌린다 (2026-09-03)
            reassignTo={session.role === "MASTER" ? "ADMIN" : undefined}
          />
        )}
      </main>

      {pwModal && <PasswordModal userId={session.id} onClose={() => setPwModal(false)} />}
    </div>
  );
}
