// 대상자 필터·명단 패널 — 관리자(#/admin)와 상담사 워크스페이스(#/counsel) 공용.
// showOutreach=true(상담사 전용)일 때만 연락 우선 큐·연락상태·상담 메모가 나타난다.
// 담당자(행정)에게는 연락 기록이 화면·CSV 어디에도 노출되지 않는다 (2026-08-30 사용자 확정).
import { useMemo, useState } from "react";
import { mockStudents, surveyAnswerLabel, type StudentRecord } from "./mockStudents";
import { exportSheet, exportSheetForResearch, CERT_CATEGORIES, certCategoryLabel } from "./csvExport";
import { domainLabels, levelRules, surveyItems } from "../lib/dataLoader";
import type { AdminSession } from "./auth";
import {
  loadOutreach,
  saveOutreachEntry,
  statusOf,
  OUTREACH_LABELS,
  OUTREACH_ORDER,
  type OutreachEntry,
  type OutreachStatus,
} from "./outreach";

export const LEVEL_NAMES: Record<number, string> = { 1: "진로탐색", 2: "진로설정", 3: "취업준비", 4: "실전취업" };
const rules = levelRules as unknown as { jas_cutoff_level3: number };

// 설문 정의에서 선택지 목록을 가져오는 헬퍼 (코드 하드코딩 금지 — §4)
type Opt = { value: string; label: string };
const optionsOf = (key: string): Opt[] => {
  const all = {
    ...(surveyItems.scored_items as Record<string, { options?: Opt[] }>),
    ...(surveyItems.unscored_items as Record<string, { options?: Opt[] }>),
  };
  return all[key]?.options ?? [];
};

/** 설문 항목 키 → 항목명 (학생 상세 모달에서 "항목명: 응답" 표기용) */
const labelOf = (key: string): string => {
  const all = {
    ...(surveyItems.scored_items as Record<string, { label?: string }>),
    ...(surveyItems.unscored_items as Record<string, { label?: string }>),
  };
  return all[key]?.label ?? key;
};

// ── 상세 필터 (2026-08-28 취·창업팀 요구 — 상담사가 대상자를 정밀 추출) ──
interface AdvFilter {
  contact: string;     // 연락 상태 — 상담사 전용(showOutreach)
  direction: string;   // 진로방향 (취업/진학·창업/미정)
  counsel: string;     // 상담 희망 (YES/NO)
  majorLink: string;   // 전공진출형/방향전환형
  homeRegion: string;  // 본가(거주지) 지역
  region: string;      // 희망 취업 지역 (복수값 포함 매칭)
  jobGroup: string;    // 희망직무 분야 (복수값 포함 매칭)
  cert: string;        // OWNED=보유 있음 / PREPARING=준비·목표만 / NONE=미입력
  certCat: string;     // 자격 분류 (OA/전공/어학/운전면허/기타)
  timing: string;      // 취업 희망시기
  gov: string;         // 정부지원 연계의향
}
const EMPTY_ADV: AdvFilter = {
  contact: "", direction: "", counsel: "", majorLink: "", homeRegion: "", region: "", jobGroup: "",
  cert: "", certCat: "", timing: "", gov: "",
};

const matchesAdv = (s: StudentRecord, f: AdvFilter, outreach: Record<string, OutreachEntry>): boolean => {
  if (f.contact && statusOf(outreach, s.student_id) !== f.contact) return false;
  if (f.direction && s.survey.career_direction !== f.direction) return false;
  if (f.counsel && s.survey.counsel_wish !== f.counsel) return false;
  if (f.majorLink && s.unscored.major_link !== f.majorLink) return false;
  if (f.homeRegion && s.unscored.home_region !== f.homeRegion) return false;
  if (f.region && !(s.unscored.region ?? "").split(",").includes(f.region)) return false;
  if (f.jobGroup && !(s.unscored.desired_job_group ?? "").split(",").includes(f.jobGroup)) return false;
  if (f.cert === "OWNED" && !s.certs.some((c) => c.status === "OWNED")) return false;
  if (f.cert === "PREPARING" && !(s.certs.length > 0 && !s.certs.some((c) => c.status === "OWNED"))) return false;
  if (f.cert === "NONE" && s.certs.length > 0) return false;
  if (f.certCat && !s.certs.some((c) => (c as { category?: string }).category === f.certCat)) return false;
  if (f.timing && s.survey.employment_timing !== f.timing) return false;
  if (f.gov && s.survey.gov_link !== f.gov) return false;
  return true;
};

// ── 빠른 필터 프리셋 (계획서 §6-2) — 여러 개 동시 선택 시 AND 결합 (2026-08-30) ──
const PRESETS: Array<{ key: string; label: string; fn: (s: StudentRecord) => boolean }> = [
  {
    key: "priority",
    label: "취업지원 우선대상",
    fn: (s) =>
      s.survey.career_direction === "EMPLOYMENT" &&
      s.result.jas >= rules.jas_cutoff_level3 &&
      ["WITHIN_3M", "WITHIN_6M"].includes(s.survey.employment_timing),
  },
  { key: "employment", label: "취업희망", fn: (s) => s.survey.career_direction === "EMPLOYMENT" },
  { key: "counsel", label: "상담희망", fn: (s) => s.survey.counsel_wish === "YES" },
  { key: "gov", label: "정부지원 연계희망", fn: (s) => s.survey.gov_link === "USE" },
  { key: "l3", label: "Level 3", fn: (s) => s.result.level === 3 },
  { key: "l4", label: "Level 4", fn: (s) => s.result.level === 4 },
  { key: "route", label: "진학·창업 Route", fn: (s) => s.result.routeTag === "FURTHER_STUDY_STARTUP" },
];

/** "오늘 연락할 학생" 판정 — 상담희망 또는 L3+ 이면서 미연락·무응답 (진학·창업 Route 제외) */
export const needsOutreachWith =
  (outreach: Record<string, OutreachEntry>) =>
  (s: StudentRecord): boolean =>
    (s.survey.counsel_wish === "YES" || s.result.level >= 3) &&
    s.result.routeTag !== "FURTHER_STUDY_STARTUP" &&
    ["NONE", "NO_RESPONSE"].includes(statusOf(outreach, s.student_id));

export default function StudentsPanel({
  session,
  showOutreach,
}: {
  session: AdminSession;
  showOutreach: boolean;
}) {
  const students = mockStudents;
  const [presets, setPresets] = useState<Set<string>>(new Set());
  const [queueOnly, setQueueOnly] = useState(false);
  const [outreach, setOutreach] = useState<Record<string, OutreachEntry>>(loadOutreach);
  const [levelFilter, setLevelFilter] = useState<number | null>(null);
  const [deptFilter, setDeptFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [adv, setAdv] = useState<AdvFilter>(EMPTY_ADV);
  const [detail, setDetail] = useState<StudentRecord | null>(null);

  const depts = useMemo(() => [...new Set(students.map((s) => s.dept))].sort(), [students]);
  const needsOutreach = needsOutreachWith(outreach);

  const filtered = useMemo(() => {
    let list = students;
    if (showOutreach && queueOnly) list = list.filter(needsOutreach);
    for (const p of PRESETS) if (presets.has(p.key)) list = list.filter(p.fn);
    if (levelFilter) list = list.filter((s) => s.result.level === levelFilter);
    if (deptFilter) list = list.filter((s) => s.dept === deptFilter);
    list = list.filter((s) => matchesAdv(s, adv, outreach));
    if (search.trim())
      list = list.filter((s) => s.name.includes(search.trim()) || s.student_id.includes(search.trim()));
    return [...list].sort((a, b) => b.result.jas - a.result.jas);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, presets, queueOnly, levelFilter, deptFilter, adv, search, outreach, showOutreach]);

  // 상담사 전용 요소를 제외한 상세 필터 구성
  const advFields = (
    [
      ...(showOutreach
        ? ([["contact", "연락 상태", OUTREACH_ORDER.map((st) => ({ value: st, label: OUTREACH_LABELS[st] }))]] as Array<
            [keyof AdvFilter, string, Opt[]]
          >)
        : []),
      ["direction", "진로방향", optionsOf("career_direction")],
      ["counsel", "상담 희망", optionsOf("counsel_wish")],
      ["majorLink", "전공연계", optionsOf("major_link")],
      ["homeRegion", "본가지역", optionsOf("home_region")],
      ["region", "희망 취업 지역", optionsOf("region")],
      ["jobGroup", "희망직무 분야", optionsOf("desired_job_group")],
      ["timing", "취업 희망시기", optionsOf("employment_timing")],
      ["gov", "정부지원 의향", optionsOf("gov_link")],
      [
        "cert",
        "자격증",
        [
          { value: "OWNED", label: "보유 있음" },
          { value: "PREPARING", label: "준비·목표만" },
          { value: "NONE", label: "미입력" },
        ],
      ],
      ["certCat", "자격 분류", CERT_CATEGORIES],
    ] as Array<[keyof AdvFilter, string, Opt[]]>
  );

  return (
    <>
      {showOutreach && (
        <div className="filter-bar">
          <button
            className={`chip chip--queue ${queueOnly ? "chip--on" : ""}`}
            onClick={() => setQueueOnly((v) => !v)}
            title="상담희망 또는 Level 3 이상 + 미연락·무응답 학생만"
          >
            📞 연락 우선 큐 ({students.filter(needsOutreach).length})
          </button>
        </div>
      )}
      <div className="filter-bar">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            className={`chip ${presets.has(p.key) ? "chip--on" : ""}`}
            onClick={() =>
              setPresets((prev) => {
                const next = new Set(prev);
                if (next.has(p.key)) next.delete(p.key);
                else next.add(p.key);
                return next;
              })
            }
          >
            {p.label}
          </button>
        ))}
        {presets.size > 1 && <span className="muted small filter-bar__hint">선택한 조건 모두 충족(AND)</span>}
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

      {/* 상세 필터 — 대상자 정밀 추출 (전공연계·지역·직무분야·자격증 등) */}
      <details className="card adv-filter" open>
        <summary>상세 필터 {Object.values(adv).some(Boolean) && <span className="adv-filter__on">적용 중</span>}</summary>
        <div className="adv-filter__grid">
          {advFields.map(([field, label, opts]) => (
            <label className="adv-filter__field" key={field}>
              <span>{label}</span>
              <select
                className="input"
                value={adv[field]}
                onChange={(e) => setAdv((prev) => ({ ...prev, [field]: e.target.value }))}
              >
                <option value="">전체</option>
                {opts.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <div className="adv-filter__actions">
          <button className="btn btn--ghost" onClick={() => setAdv(EMPTY_ADV)}>필터 초기화</button>
        </div>
      </details>

      <div className="filter-result-bar">
        <p className="muted filter-count">{filtered.length}명 (JAS 높은 순)</p>
        <div className="filter-result-bar__dl">
          <button
            className="btn btn--primary btn--sm"
            onClick={() => exportSheet("01_학생상태", filtered, { includeOutreach: showOutreach })}
          >
            필터 결과 CSV (운영용)
          </button>
          <button className="btn btn--ghost btn--sm" onClick={() => exportSheetForResearch("01_학생상태", filtered)}>
            필터 결과 CSV (익명)
          </button>
        </div>
      </div>
      <div className="table-wrap card">
        <table className="admin-table admin-table--hover">
          <thead>
            <tr>
              <th>학번</th><th>성명</th><th>연락처</th><th>학과</th><th>학년</th><th>진로방향</th>
              <th>전공연계</th><th>JAS</th><th>Level</th><th>희망시기</th><th>상담</th>
              {showOutreach && <th>연락상태</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => {
              const st = statusOf(outreach, s.student_id);
              return (
                <tr key={s.student_id} onClick={() => setDetail(s)}>
                  <td>{s.student_id}</td>
                  <td><strong>{s.name}</strong></td>
                  <td className="num">
                    {/* 행 클릭(모달)과 분리 — 전화 걸기/복사용 */}
                    <a href={`tel:${s.phone.replace(/-/g, "")}`} onClick={(e) => e.stopPropagation()}>
                      {s.phone}
                    </a>
                  </td>
                  <td>{s.dept}</td>
                  <td>{s.grade}</td>
                  <td>{surveyAnswerLabel("career_direction", s.survey.career_direction)}</td>
                  <td>{s.unscored.major_link === "Y" ? "전공진출" : s.unscored.major_link === "N" ? "방향전환" : "—"}</td>
                  <td className="num">{s.result.jas}</td>
                  <td><span className={`lv-badge lv-badge--l${s.result.level}`}>L{s.result.level} {LEVEL_NAMES[s.result.level]}</span></td>
                  <td>{surveyAnswerLabel("employment_timing", s.survey.employment_timing)}</td>
                  <td>{s.survey.counsel_wish === "YES" ? "희망" : "—"}</td>
                  {showOutreach && (
                    <td><span className={`outreach-badge outreach-badge--${st.toLowerCase()}`}>{OUTREACH_LABELS[st]}</span></td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="modal-backdrop" onClick={() => setDetail(null)}>
          <div className="modal card admin-detail" onClick={(e) => e.stopPropagation()}>
            <div className="admin-detail__head">
              <div>
                <h3>{detail.name} <span className="muted">({detail.student_id} · {detail.dept} {detail.grade}학년)</span></h3>
                <p className="admin-detail__phone">
                  📞 <a href={`tel:${detail.phone.replace(/-/g, "")}`}>{detail.phone}</a>
                </p>
                <span className={`lv-badge lv-badge--l${detail.result.level}`}>
                  Level {detail.result.level} · {LEVEL_NAMES[detail.result.level]}
                </span>
                {detail.result.routeTag === "FURTHER_STUDY_STARTUP" && <span className="lv-badge">진학·창업 Route</span>}
              </div>
              <button className="btn btn--ghost" onClick={() => setDetail(null)}>✕ 닫기</button>
            </div>

            {/* 연락 기록 — 상담사 워크스페이스에서만 노출·수정 (담당자 화면에는 없음) */}
            {showOutreach && (
              <OutreachEditor
                key={detail.student_id}
                studentId={detail.student_id}
                entry={outreach[detail.student_id]}
                by={session.name}
                onSave={(next) => setOutreach(next)}
              />
            )}

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
                    <li key={k}>{labelOf(k)}: {surveyAnswerLabel(k, v)}</li>
                  ))}
                  <li>전공연계: {surveyAnswerLabel("major_link", detail.unscored.major_link)}</li>
                  <li>
                    본가 {surveyAnswerLabel("home_region", detail.unscored.home_region)} → 희망{" "}
                    {surveyAnswerLabel("region", detail.unscored.region)}
                  </li>
                  <li>희망직무 분야: {surveyAnswerLabel("desired_job_group", detail.unscored.desired_job_group)}</li>
                  <li>희망직무: {detail.unscored.desired_job || "—"}</li>
                  {/* 연구 연계·조건부 문항 — 응답이 있을 때만 표시 (상담 참고용) */}
                  {["non_employment_type", "career_shift_timing", "career_shift_reason", "prep_difficulty", "roadmap_demand"].map(
                    (k) =>
                      detail.unscored[k] ? (
                        <li key={k}>{labelOf(k)}: {surveyAnswerLabel(k, detail.unscored[k])}</li>
                      ) : null
                  )}
                  <li>
                    자격증:{" "}
                    {detail.certs
                      .map((c) => {
                        const cat = (c as { category?: string }).category;
                        const status = c.status === "OWNED" ? "보유" : c.status === "PREPARING" ? "준비 중" : "목표";
                        return `${c.cert_name}${cat ? ` [${certCategoryLabel(cat)}]` : ""} · ${status}`;
                      })
                      .join(", ") || "—"}
                  </li>
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
    </>
  );
}

// 연락 기록 편집기 — 연락 상태 + 상담 메모 (상담사 워크스페이스 전용)
function OutreachEditor({
  studentId,
  entry,
  by,
  onSave,
}: {
  studentId: string;
  entry: OutreachEntry | undefined;
  by: string;
  onSave: (next: Record<string, OutreachEntry>) => void;
}) {
  const [status, setStatus] = useState<OutreachStatus>(entry?.status ?? "NONE");
  const [memo, setMemo] = useState(entry?.memo ?? "");
  const [saved, setSaved] = useState(false);
  const dirty = status !== (entry?.status ?? "NONE") || memo !== (entry?.memo ?? "");

  return (
    <div className="outreach-editor">
      <div className="outreach-editor__row">
        <strong>연락 기록</strong>
        <div className="outreach-editor__chips">
          {OUTREACH_ORDER.map((st) => (
            <button
              key={st}
              type="button"
              className={`chip chip--sm ${status === st ? "chip--on" : ""}`}
              onClick={() => { setStatus(st); setSaved(false); }}
            >
              {OUTREACH_LABELS[st]}
            </button>
          ))}
        </div>
      </div>
      <textarea
        className="input outreach-editor__memo"
        rows={2}
        placeholder="상담 메모 (예: 8/30 문자 발송, 9/2 상담 예약)"
        value={memo}
        onChange={(e) => { setMemo(e.target.value); setSaved(false); }}
      />
      <div className="outreach-editor__foot">
        <span className="muted small">
          {entry
            ? `마지막 기록: ${entry.updated_at.slice(0, 16).replace("T", " ")} · ${entry.by}`
            : "아직 연락 기록이 없습니다."}
          {saved && <strong className="outreach-editor__saved"> 저장됨 ✓</strong>}
        </span>
        <button
          className="btn btn--primary btn--sm"
          disabled={!dirty}
          onClick={() => {
            onSave(saveOutreachEntry(studentId, { status, memo, by }));
            setSaved(true);
          }}
        >
          기록 저장
        </button>
      </div>
    </div>
  );
}
