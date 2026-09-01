// 관리자 화면(#/admin) — 담당자(행정)·마스터 전용. 계획서 §6.
// 상담사 계열 계정은 전용 워크스페이스(#/counsel)로 자동 이동하며,
// 이 화면에는 연락 기록(연락상태·상담 메모)이 일절 노출되지 않는다 (2026-08-30 사용자 확정).
// 시범: mock 40명(실제 엔진 판정)을 미리보기 모드로 표시. Firestore 연동 시 데이터 소스만 교체.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStudents, inPeriod, invalidateStudentsCache } from "./responsesSource";
import {
  exportSheet,
  exportSheetForResearch,
  exportIntegrated,
  exportIntegratedForResearch,
  sheetKeys,
} from "./csvExport";
import { recommendationMaster, domainLabels, levelRules } from "../lib/dataLoader";

const rules = levelRules as unknown as {
  jas_cutoff_level3: number;
  gates: { timing_gate: { values: string[] } };
};
import { getSession, logout, canAccess, isCounselSide, homeRoute, ROLE_LABELS, type AdminSession } from "./auth";
import AdminLogin from "./Login";
import Accounts from "./Accounts";
import PasswordModal from "./PasswordModal";
import StudentsPanel, { LEVEL_NAMES } from "./StudentsPanel";

type Section = "overview" | "students" | "recommend" | "download" | "accounts";

export default function Dashboard() {
  const navigate = useNavigate();
  const { students, source, skipped } = useStudents(); // 클라우드 모드 = 실측만 (mock 위장 금지 — 감사 P3-04)
  const [session, setSession] = useState<AdminSession | null>(getSession);
  const [pwModal, setPwModal] = useState(false);
  const [section, setSection] = useState<Section>("overview");
  const [masterState, setMasterState] = useState(
    () => (recommendationMaster as { activities: Array<{ recommendation_code: string; name: string; owner: string; levels: number[]; weak_domains: string[]; priority: number; active: boolean; active_from: string; active_to: string; student_desc: string }> }).activities
  );

  // 상담사 계열은 이 화면 접근 불가 — 전용 워크스페이스로 이동
  useEffect(() => {
    if (session && isCounselSide(session.role) && session.role !== "MASTER") navigate("/counsel", { replace: true });
  }, [session, navigate]);

  // ── 집계 기간 (검사 실시일 기준) — 종합 현황·데이터 다운로드 공통 적용 (2026-08-31) ──
  const [period, setPeriod] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const periodOn = Boolean(period.from || period.to);
  const periodStudents = useMemo(
    () => (periodOn ? students.filter((s) => inPeriod(s, period.from, period.to)) : students),
    [students, period, periodOn]
  );

  // ── 집계 ──
  const kpi = useMemo(() => {
    const total = periodStudents.length;
    const byLevel = [1, 2, 3, 4].map((l) => periodStudents.filter((s) => s.result.level === l).length);
    const avgJas = total > 0 ? Math.round(periodStudents.reduce((s, x) => s + x.result.jas, 0) / total) : 0;
    // 프리셋 "취업지원 우선대상"과 동일 정의: 진로=취업 AND JAS≥컷오프 AND 희망시기≤6개월
    const priority = periodStudents.filter(
      (s) =>
        s.survey.career_direction === "EMPLOYMENT" &&
        s.result.jas >= rules.jas_cutoff_level3 &&
        rules.gates.timing_gate.values.includes(s.survey.employment_timing) // level_rules 주입 — 중복 하드코딩 제거 (감사 P3-13)
    ).length;
    const counsel = periodStudents.filter((s) => s.survey.counsel_wish === "YES").length;
    const nonEmp = periodStudents.filter((s) => s.result.routeTag === "FURTHER_STUDY_STARTUP").length;
    return { total, byLevel, avgJas, priority, counsel, nonEmp };
  }, [periodStudents]);

  const depts = useMemo(() => [...new Set(periodStudents.map((s) => s.dept))].sort(), [periodStudents]);
  const deptStats = useMemo(
    () =>
      depts.map((d) => {
        const list = periodStudents.filter((s) => s.dept === d);
        return {
          dept: d,
          count: list.length,
          avgJas: Math.round(list.reduce((s, x) => s + x.result.jas, 0) / list.length),
          l34: list.filter((s) => s.result.level >= 3).length,
          counsel: list.filter((s) => s.survey.counsel_wish === "YES").length,
        };
      }),
    [periodStudents, depts]
  );

  const maxLevelCount = Math.max(...kpi.byLevel, 1);

  // 집계 기간 설정 바 — 종합 현황·데이터 다운로드 두 섹션에 공통 렌더 (상태 공유)
  const periodBar = (
    <div className="card period-bar">
      <span className="period-bar__label">집계 기간 (검사 실시일)</span>
      <input
        type="date"
        className="input period-bar__date"
        value={period.from}
        max={period.to || undefined}
        onChange={(e) => setPeriod((p) => ({ ...p, from: e.target.value }))}
      />
      <span className="muted">~</span>
      <input
        type="date"
        className="input period-bar__date"
        value={period.to}
        min={period.from || undefined}
        onChange={(e) => setPeriod((p) => ({ ...p, to: e.target.value }))}
      />
      {periodOn ? (
        <>
          <span className="period-bar__on">적용 중 — {periodStudents.length}명 / 전체 {students.length}명</span>
          <button className="btn btn--ghost btn--sm" onClick={() => setPeriod({ from: "", to: "" })}>
            전체 기간으로
          </button>
        </>
      ) : (
        <span className="muted small">비워두면 전체 기간 기준으로 집계·추출합니다.</span>
      )}
    </div>
  );

  // ── 인증 게이트 ──
  if (!session)
    return (
      <AdminLogin
        onLogin={(s) => {
          setSession(s);
          navigate(homeRoute(s.role), { replace: true });
        }}
      />
    );

  const sections = (
    [
      ["overview", "종합 현황"],
      ["students", "대상자 필터·명단"],
      ["recommend", "추천활동 관리"],
      ["download", "데이터 다운로드"],
      ["accounts", "담당자 계정 관리"],
    ] as Array<[Section, string]>
  ).filter(([key]) => canAccess(session.role, key));

  return (
    <div className="admin">
      <aside className="admin__side">
        <div className="admin__brand">
          <span className="app-header__logo">MJC</span>
          <div>
            <strong>MJC-READY 관리자</strong>
            <span>학생지원처 취·창업팀</span>
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
            <button className="admin__nav-item admin__nav-item--counsel" onClick={() => navigate("/counsel")}>
              상담사 워크스페이스 →
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
              onClick={() => { logout(); setSession(null); setSection("overview"); }}
            >
              로그아웃
            </button>
          </div>
        </div>
        <button className="admin__back" onClick={() => navigate("/")}>← 학생 화면으로</button>
      </aside>

      <main className="admin__main">
        <div className="admin__banner">
          {source === "CLOUD" &&
            `실측 데이터 — Firebase에 저장된 학생 응답 ${students.length}건을 표시 중입니다.${skipped ? ` (형식 오류로 제외 ${skipped}건 — 마스터에게 문의)` : ""}`}
          {source === "LOADING" && "데이터 불러오는 중… (공유 저장소 조회)"}
          {source === "ERROR" &&
            "⚠ 학생 응답 조회 실패 — 네트워크·로그인·규칙 게시 상태를 확인한 뒤 새로고침해 주세요. (실측 데이터가 있어도 지금은 표시되지 않습니다)"}
          {source === "MOCK" &&
            `미리보기 모드 — 가상 학생 ${students.length}명(실제 판정엔진 통과)으로 표시 중. Firebase 설정 후 실측 데이터로 자동 전환됩니다.`}
          {source !== "LOADING" && (
            <button className="btn btn--ghost btn--sm" style={{ marginLeft: 8 }} onClick={() => invalidateStudentsCache()}>
              ↻ 새로고침
            </button>
          )}
        </div>

        {section === "overview" && (
          <>
            <h1 className="admin__title">종합 현황</h1>
            {periodBar}
            <div className="kpi-row">
              <div className="kpi"><span>전체 응답자</span><strong>{kpi.total}</strong></div>
              <div className="kpi kpi--accent"><span>취업지원 우선대상</span><strong>{kpi.priority}</strong></div>
              <div className="kpi"><span>평균 구직활성도</span><strong>{kpi.avgJas}</strong></div>
              <div className="kpi"><span>상담 희망</span><strong>{kpi.counsel}</strong></div>
              <div className="kpi"><span>진학·창업 Route</span><strong>{kpi.nonEmp}</strong></div>
            </div>

            <div className="admin-grid">
              <section className="card">
                <h2 className="card__title">Level 분포</h2>
                <div className="level-dist">
                  {kpi.byLevel.map((count, i) => (
                    <div className="level-dist__row" key={i}>
                      <span className="level-dist__label">L{i + 1} {LEVEL_NAMES[i + 1]}</span>
                      <div className="level-dist__track">
                        <div
                          className={`level-dist__fill level-dist__fill--l${i + 1}`}
                          style={{ width: `${(count / maxLevelCount) * 100}%` }}
                        />
                      </div>
                      <strong className="level-dist__count">{count}명</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className="card">
                <h2 className="card__title">학과별 현황</h2>
                <div className="table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr><th>학과</th><th>응답</th><th>평균 JAS</th><th>L3+</th><th>상담희망</th></tr>
                    </thead>
                    <tbody>
                      {deptStats.map((d) => (
                        <tr key={d.dept}>
                          <td>{d.dept}</td>
                          <td>{d.count}</td>
                          <td>{d.avgJas}</td>
                          <td>{d.l34}</td>
                          <td>{d.counsel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </>
        )}

        {section === "students" && (
          <>
            <h1 className="admin__title">대상자 필터·명단</h1>
            {/* 담당자(행정) 화면 — 연락 기록(연락상태·메모)은 비노출 */}
            <StudentsPanel session={session} showOutreach={false} />
          </>
        )}

        {section === "recommend" && (
          <>
            <h1 className="admin__title">추천활동 관리 (Recommendation Master)</h1>
            <p className="muted">
              시범: 로컬 미리보기 — ON/OFF 전환은 이 화면에서만 반영됩니다. 본 구현 시 Firestore recommendationMaster에 저장.
            </p>
            <div className="table-wrap card">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>코드</th><th>활동명</th><th>담당</th><th>적용 Level</th><th>취약영역</th>
                    <th>우선순위</th><th>활성기간</th><th>활성</th>
                  </tr>
                </thead>
                <tbody>
                  {masterState.map((a, i) => (
                    <tr key={a.recommendation_code} className={a.active ? "" : "row-off"}>
                      <td className="code">{a.recommendation_code}</td>
                      <td className="cell-wrap"><strong>{a.name}</strong><br /><span className="muted small">{a.student_desc}</span></td>
                      <td>{a.owner === "CAREER" ? "진로컨설턴트" : "취업컨설턴트"}</td>
                      <td>{a.levels.map((l) => `L${l}`).join(" ")}</td>
                      <td>{a.weak_domains.map((d) => (d === "ANY" ? "전체" : domainLabels[d])).join(" · ")}</td>
                      <td className="num">{a.priority}</td>
                      <td className="small">{a.active_from} ~ {a.active_to}</td>
                      <td>
                        <button
                          className={`toggle ${a.active ? "toggle--on" : ""}`}
                          onClick={() =>
                            setMasterState((prev) => prev.map((x, j) => (j === i ? { ...x, active: !x.active } : x)))
                          }
                        >
                          {a.active ? "ON" : "OFF"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {section === "download" && (
          <>
            <h1 className="admin__title">데이터 다운로드</h1>
            <p className="muted">
              전체 항목을 <strong>시트 하나(1 학생 = 1행)</strong>로 통합해 한 번에 내려받습니다. UTF-8 BOM — Excel 한글 호환.
              아래 <strong>집계 기간</strong>을 설정하면 해당 기간에 검사를 실시한 학생만 추출됩니다 (비우면 전체).
            </p>
            {periodBar}
            <p className="muted">
              <strong>운영용(실명)</strong>은 학번·성명이 포함된 개인정보 파일 — 접근 제한된 폴더에만 보관하세요.
              <strong> 연구용(익명)</strong>은 학번을 익명 일련번호(R001…)로 치환하고 성명을 제거한 추출본 —
              교내 연구 제공은 반드시 이 파일만 사용합니다.
            </p>
            <div className="card dl-card dl-card--main">
              <strong>통합 다운로드 (시트 1개)</strong>
              <p className="muted">
                기본 정보·설문 전체 응답·3대 지표·Level·진단 영역점수·보완영역·자격증(상태별 요약)·추천활동을
                학생 1명당 1행으로 담은 단일 시트입니다.
              </p>
              <button className="btn btn--primary" onClick={() => exportIntegrated(periodStudents)}>
                통합 CSV (실명)
              </button>
              <button className="btn btn--ghost" onClick={() => exportIntegratedForResearch(periodStudents)}>
                통합 CSV (연구용 익명)
              </button>
            </div>
            <details className="dl-details">
              <summary>개별 시트 다운로드 (원자료 Long Format — 통계분석용)</summary>
              <p className="muted">
                계획서 §6-2의 5개 Sheet 정의(data/excel_columns.json)대로 시트별 원자료를 따로 추출합니다.
                자격증·설문·진단 원자료는 1건=1행(Long Format)이라 통계분석에 적합합니다.
              </p>
              <div className="dl-grid">
                {sheetKeys.map((k) => (
                  <div className="card dl-card" key={k}>
                    <strong>{k}</strong>
                    <button className="btn btn--primary" onClick={() => exportSheet(k, periodStudents)}>
                      운영용 CSV (실명)
                    </button>
                    <button className="btn btn--ghost" onClick={() => exportSheetForResearch(k, periodStudents)}>
                      연구용 CSV (익명)
                    </button>
                  </div>
                ))}
              </div>
            </details>
          </>
        )}

        {section === "accounts" && session.role === "MASTER" && (
          <Accounts
            title="담당자 계정 관리"
            description="담당자(행정) 계정의 가입 신청을 승인하거나 사용을 중지·삭제합니다. 상담사 계정은 상담사 워크스페이스에서 별도 관리합니다."
            roles={["ADMIN"]} // 마스터 계정은 어떤 목록에도 노출하지 않음 (§6.4)
          />
        )}
      </main>

      {pwModal && <PasswordModal userId={session.id} onClose={() => setPwModal(false)} />}
    </div>
  );
}
