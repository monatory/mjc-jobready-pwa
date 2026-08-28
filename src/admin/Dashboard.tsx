// 관리자 대시보드 — 계획서 §6 (Dashboard·대상자 필터·학생 상세·추천활동 관리·Excel 다운로드)
// 시범: mock 40명(실제 엔진 판정)을 미리보기 모드로 표시. Firestore 연동 시 데이터 소스만 교체.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { mockStudents, surveyAnswerLabel, type StudentRecord } from "./mockStudents";
import { exportSheet, exportSheetForResearch, sheetKeys } from "./csvExport";
import { recommendationMaster, domainLabels, levelRules } from "../lib/dataLoader";

type Section = "overview" | "students" | "recommend" | "download";

const LEVEL_NAMES: Record<number, string> = { 1: "진로탐색", 2: "진로설정", 3: "취업준비", 4: "실전취업" };
const rules = levelRules as unknown as { jas_cutoff_level3: number };

// ── 빠른 필터 프리셋 (계획서 §6-2) ─────────────────────────────
const PRESETS: Array<{ key: string; label: string; fn: (s: StudentRecord) => boolean }> = [
  {
    key: "priority",
    label: "취업지원 우선대상",
    fn: (s) =>
      s.survey.career_direction === "EMPLOYMENT" &&
      s.result.jas >= rules.jas_cutoff_level3 &&
      ["WITHIN_3M", "WITHIN_6M"].includes(s.survey.employment_timing),
  },
  { key: "l3", label: "Level 3", fn: (s) => s.result.level === 3 },
  { key: "l4", label: "Level 4", fn: (s) => s.result.level === 4 },
  { key: "counsel", label: "상담희망", fn: (s) => s.survey.counsel_wish === "YES" },
  { key: "gov", label: "정부지원 연계 후보", fn: (s) => s.survey.gov_link === "USE" },
  { key: "route", label: "진학·창업 Route", fn: (s) => s.result.routeTag === "FURTHER_STUDY_STARTUP" },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const students = mockStudents;
  const [section, setSection] = useState<Section>("overview");
  const [preset, setPreset] = useState<string | null>(null);
  const [levelFilter, setLevelFilter] = useState<number | null>(null);
  const [deptFilter, setDeptFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<StudentRecord | null>(null);
  const [masterState, setMasterState] = useState(
    () => (recommendationMaster as { activities: Array<{ recommendation_code: string; name: string; owner: string; levels: number[]; weak_domains: string[]; priority: number; active: boolean; active_from: string; active_to: string; student_desc: string }> }).activities
  );

  const depts = useMemo(() => [...new Set(students.map((s) => s.dept))].sort(), [students]);

  const filtered = useMemo(() => {
    let list = students;
    if (preset) {
      const p = PRESETS.find((x) => x.key === preset);
      if (p) list = list.filter(p.fn);
    }
    if (levelFilter) list = list.filter((s) => s.result.level === levelFilter);
    if (deptFilter) list = list.filter((s) => s.dept === deptFilter);
    if (search.trim())
      list = list.filter((s) => s.name.includes(search.trim()) || s.student_id.includes(search.trim()));
    return [...list].sort((a, b) => b.result.jas - a.result.jas);
  }, [students, preset, levelFilter, deptFilter, search]);

  // ── 집계 ──
  const kpi = useMemo(() => {
    const total = students.length;
    const byLevel = [1, 2, 3, 4].map((l) => students.filter((s) => s.result.level === l).length);
    const avgJas = Math.round(students.reduce((s, x) => s + x.result.jas, 0) / total);
    const priority = students.filter(PRESETS[0].fn).length;
    const counsel = students.filter((s) => s.survey.counsel_wish === "YES").length;
    const nonEmp = students.filter((s) => s.result.routeTag === "FURTHER_STUDY_STARTUP").length;
    return { total, byLevel, avgJas, priority, counsel, nonEmp };
  }, [students]);

  const deptStats = useMemo(
    () =>
      depts.map((d) => {
        const list = students.filter((s) => s.dept === d);
        return {
          dept: d,
          count: list.length,
          avgJas: Math.round(list.reduce((s, x) => s + x.result.jas, 0) / list.length),
          l34: list.filter((s) => s.result.level >= 3).length,
          counsel: list.filter((s) => s.survey.counsel_wish === "YES").length,
        };
      }),
    [students, depts]
  );

  const maxLevelCount = Math.max(...kpi.byLevel, 1);

  return (
    <div className="admin">
      <aside className="admin__side">
        <div className="admin__brand">
          <span className="app-header__logo">MJC</span>
          <div>
            <strong>MJC-READY 관리자</strong>
            <span>AI융합진로지원센터</span>
          </div>
        </div>
        <nav className="admin__nav">
          {(
            [
              ["overview", "종합 현황"],
              ["students", "대상자 필터·명단"],
              ["recommend", "추천활동 관리"],
              ["download", "데이터 다운로드"],
            ] as Array<[Section, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              className={`admin__nav-item ${section === key ? "admin__nav-item--on" : ""}`}
              onClick={() => setSection(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        <button className="admin__back" onClick={() => navigate("/")}>← 학생 화면으로</button>
      </aside>

      <main className="admin__main">
        <div className="admin__banner">
          미리보기 모드 — 가상 학생 {students.length}명(실제 판정엔진 통과)으로 표시 중. Firestore 연동 시 실측 데이터로 자동 전환됩니다.
        </div>

        {section === "overview" && (
          <>
            <h1 className="admin__title">종합 현황</h1>
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
            <div className="filter-bar">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  className={`chip ${preset === p.key ? "chip--on" : ""}`}
                  onClick={() => setPreset(preset === p.key ? null : p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="filter-bar">
              {[1, 2, 3, 4].map((l) => (
                <button
                  key={l}
                  className={`chip ${levelFilter === l ? "chip--on" : ""}`}
                  onClick={() => setLevelFilter(levelFilter === l ? null : l)}
                >
                  Level {l}
                </button>
              ))}
              <select className="input filter-bar__select" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
                <option value="">전체 학과</option>
                {depts.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <input
                className="input filter-bar__search"
                placeholder="이름·학번 검색"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <p className="muted filter-count">{filtered.length}명 (JAS 높은 순)</p>
            <div className="table-wrap card">
              <table className="admin-table admin-table--hover">
                <thead>
                  <tr>
                    <th>학번</th><th>성명</th><th>학과</th><th>학년</th><th>진로방향</th>
                    <th>JAS</th><th>Level</th><th>희망시기</th><th>상담</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr key={s.student_id} onClick={() => setDetail(s)}>
                      <td>{s.student_id}</td>
                      <td><strong>{s.name}</strong></td>
                      <td>{s.dept}</td>
                      <td>{s.grade}</td>
                      <td>{surveyAnswerLabel("career_direction", s.survey.career_direction)}</td>
                      <td className="num">{s.result.jas}</td>
                      <td><span className={`lv-badge lv-badge--l${s.result.level}`}>L{s.result.level} {LEVEL_NAMES[s.result.level]}</span></td>
                      <td>{surveyAnswerLabel("employment_timing", s.survey.employment_timing)}</td>
                      <td>{s.survey.counsel_wish === "YES" ? "희망" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
                      <td><strong>{a.name}</strong><br /><span className="muted small">{a.student_desc}</span></td>
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
              계획서 §6-2의 5개 Sheet 정의(data/excel_columns.json)대로 원자료를 추출합니다. UTF-8 BOM — Excel 한글 호환.
              시범은 Sheet별 CSV, 본 구현 시 xlsx 다중 시트 1파일로 통합(제안 12건-⑥). 다운로드는 현재 필터와 무관하게 전체 기준.
            </p>
            <p className="muted">
              <strong>운영용(실명)</strong>은 학번·성명이 포함된 개인정보 파일 — 접근 제한된 폴더에만 보관하세요.
              <strong> 연구용(익명)</strong>은 학번을 익명 일련번호(R001…)로 치환하고 성명을 제거한 추출본 —
              교내 연구 제공은 반드시 이 파일만 사용합니다.
            </p>
            <div className="dl-grid">
              {sheetKeys.map((k) => (
                <div className="card dl-card" key={k}>
                  <strong>{k}</strong>
                  <button className="btn btn--primary" onClick={() => exportSheet(k, students)}>
                    운영용 CSV (실명)
                  </button>
                  <button className="btn btn--ghost" onClick={() => exportSheetForResearch(k, students)}>
                    연구용 CSV (익명)
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </main>

      {detail && (
        <div className="modal-backdrop" onClick={() => setDetail(null)}>
          <div className="modal card admin-detail" onClick={(e) => e.stopPropagation()}>
            <div className="admin-detail__head">
              <div>
                <h3>{detail.name} <span className="muted">({detail.student_id} · {detail.dept} {detail.grade}학년)</span></h3>
                <span className={`lv-badge lv-badge--l${detail.result.level}`}>
                  Level {detail.result.level} · {LEVEL_NAMES[detail.result.level]}
                </span>
                {detail.result.routeTag === "FURTHER_STUDY_STARTUP" && <span className="lv-badge">진학·창업 Route</span>}
              </div>
              <button className="btn btn--ghost" onClick={() => setDetail(null)}>✕ 닫기</button>
            </div>

            <div className="admin-detail__grid">
              <section>
                <h4>지표</h4>
                <p>JAS <strong>{detail.result.jas}</strong> · JRS <strong>{detail.result.jrs ?? "—"}</strong> · CDS <strong>{detail.result.cds ?? "—"}</strong></p>
                <h4>판정 근거</h4>
                <ul className="reason-list">
                  {detail.result.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
                <h4>영역 점수</h4>
                <ul className="reason-list">
                  {Object.entries(detail.result.domainScores).map(([d, v]) => (
                    <li key={d}>
                      {domainLabels[d]}: {v?.toFixed(1) ?? "—"}
                      {detail.weak.some((w) => w.domain === d) ? " ← 보완영역" : ""}
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <h4>설문 원응답</h4>
                <ul className="reason-list">
                  {Object.entries(detail.survey).map(([k, v]) => (
                    <li key={k}>{surveyAnswerLabel(k, v)}</li>
                  ))}
                  <li>희망직무: {detail.unscored.desired_job || "—"}</li>
                  <li>자격증: {detail.certs.map((c) => c.cert_name).join(", ") || "—"}</li>
                </ul>
                <h4>추천활동 ({detail.recs.length})</h4>
                <ul className="reason-list">
                  {detail.recs.map((a) => (
                    <li key={a.recommendation_code}>
                      {a.name} <span className="muted">({a.owner === "CAREER" ? "진로" : "취업"}컨설턴트)</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
