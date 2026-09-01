// Excel용 CSV 내보내기 — 컬럼 정의는 data/excel_columns.json에서 주입 (하드코딩 금지).
// UTF-8 BOM으로 Excel 한글 호환. 시범: Sheet별 CSV 파일 / 본 구현: xlsx 다중 시트 1파일(제안 12건-⑥).
import excelColumnsJson from "../../data/excel_columns.json";
import { surveyItems, domainLabels, diagItems, diagnosticBank } from "../lib/dataLoader";
import { localDateStr } from "../lib/dates";
import { surveyAnswerLabel, type StudentRecord } from "./mockStudents";
import {
  loadOutreach,
  statusOf,
  referralStageOf,
  employmentStatusOf,
  OUTREACH_LABELS,
  REFERRAL_LABELS,
  EMPLOYMENT_LABELS,
} from "./outreach";
import { loadAgencies, agencyName } from "./agencies";
import { gradeLabel } from "../lib/sessionState";

type ColumnDef = { key: string; label: string };
const SHEETS = excelColumnsJson.sheets as Record<string, ColumnDef[]>;

/** 자격증 분류 코드 → 라벨 (survey_items.certification_entry.category_values) */
export const CERT_CATEGORIES = ((surveyItems as { certification_entry: { category_values?: Array<{ value: string; label: string }> } })
  .certification_entry.category_values ?? []);
export function certCategoryLabel(code: string | undefined): string {
  if (!code) return "";
  return CERT_CATEGORIES.find((c) => c.value === code)?.label ?? code;
}

const csvCell = (v: unknown): string => {
  let s = v == null ? "" : String(v);
  if (s === "—") s = ""; // 결측 표기 통일 — 화면용 "—"는 통계 도구에서 값으로 오인됨 (감사 P5-09)
  // Excel 수식 주입 방어 (감사 P5-02): 자유입력(성명·희망직무·메모)이 =, +, -, @ 등으로 시작하면
  // Excel이 수식으로 실행한다 — 선행 아포스트로피로 텍스트 강제 (OWASP 표준 대응)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; // \r 단독 포함 값도 이스케이프 (감사 P5-12)
};

function downloadCsv(filename: string, rows: string[][]): void {
  const body = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 01_학생상태 시트의 학생 1명 → 행 객체 매핑 (통합 다운로드와 공용) */
function studentStateRow(
  s: StudentRecord,
  outreach: ReturnType<typeof loadOutreach>,
  agencies: ReturnType<typeof loadAgencies>
): Record<string, unknown> {
  return {
    student_id: s.student_id,
    name: s.name,
    dept: s.dept,
    grade: gradeLabel(s.grade), // "본과정 1학년"·"졸업(2025)" 등 표시 라벨
    phone: s.phone,
    outreach_status: OUTREACH_LABELS[statusOf(outreach, s.student_id)],
    outreach_memo: outreach[s.student_id]?.memo ?? "",
    session_count: outreach[s.student_id]?.sessions?.length ?? 0,
    counsel_summary: outreach[s.student_id]?.final_summary ?? "",
    referral_stage: REFERRAL_LABELS[referralStageOf(outreach, s.student_id)],
    referral_agency: agencyName(agencies, outreach[s.student_id]?.referral?.agency_id),
    employment_status: EMPLOYMENT_LABELS[employmentStatusOf(outreach, s.student_id)],
    employer: outreach[s.student_id]?.employment?.employer ?? "",
    semester: s.semester,
    career_direction: surveyAnswerLabel("career_direction", s.survey.career_direction),
    major_link: surveyAnswerLabel("major_link", s.unscored.major_link),
    jas: s.result.jas,
    jrs: s.result.jrs ?? "",
    cds: s.result.cds ?? "",
    level: s.result.level,
    route_tag: s.result.routeTag,
    employment_timing: surveyAnswerLabel("employment_timing", s.survey.employment_timing),
    desired_job_group: surveyAnswerLabel("desired_job_group", s.unscored.desired_job_group),
    desired_job: s.unscored.desired_job ?? "",
    home_region: surveyAnswerLabel("home_region", s.unscored.home_region),
    region: surveyAnswerLabel("region", s.unscored.region),
    gov_link: surveyAnswerLabel("gov_link", s.survey.gov_link),
    counsel_wish: s.survey.counsel_wish === "YES" ? "희망" : "미희망",
    consent_view: "동의",
  };
}

/** Sheet 정의 → 학생 레코드 배열을 행으로 평탄화 */
function buildRows(sheetKey: string, students: StudentRecord[]): string[][] {
  const cols = SHEETS[sheetKey];
  const header = cols.map((c) => c.label);
  const outreach = loadOutreach(); // 상담사 기록 — 내보내기 시점 스냅샷
  const agencies = loadAgencies();

  const rowsOf = (s: StudentRecord): Array<Record<string, unknown>> => {
    switch (sheetKey) {
      case "01_학생상태":
        return [studentStateRow(s, outreach, agencies)];
      case "02_설문원자료":
        return Object.entries({ ...s.survey, ...s.unscored }).map(([itemKey, v]) => ({
          student_id: s.student_id,
          semester: s.semester,
          item_key: itemKey,
          answer_value: v ?? "",
          answer_label: v ? surveyAnswerLabel(itemKey, v) : "", // 결측은 빈칸으로 통일 (감사 P5-09)
          answered_at: s.completed_at,
          updated_at: s.completed_at,
          survey_version: (surveyItems as { version: string }).version,
        }));
      case "03_자격증현황":
        return s.certs.map((c) => ({
          student_id: s.student_id,
          semester: s.semester, // 다학기 누적 시 학기 귀속·join 키 (감사 P5-08)
          cert_name: c.cert_name,
          category: certCategoryLabel((c as { category?: string }).category),
          status: c.status === "OWNED" ? "보유" : c.status === "PREPARING" ? "준비 중" : "목표",
          target_or_acquired_date: "",
          memo: "",
        }));
      case "04_진단점수":
        return Object.entries(s.diag).map(([qid, v]) => {
          // 영역은 문항 정의(diagnostic_bank)의 실제 domain 코드로 — ID 앞 2글자 추정 금지 (감사 P5-07)
          const domain = diagItems.find((it) => it.id === qid)?.domain ?? "";
          const avg = (s.result as { domainScores?: Record<string, number> }).domainScores?.[domain];
          return {
            student_id: s.student_id,
            semester: s.semester,
            question_id: qid,
            domain,
            raw_score: v,
            domain_avg: avg != null ? Math.round(avg * 100) / 100 : "",
            gate_passed: s.result.gates.employment && s.result.gates.timing ? "Y" : "N",
            critical_unmet: s.result.gates.level4_signals.required_ok ? "N" : "Y",
            diagnostic_version: (diagnosticBank as { version?: string }).version ?? "",
          };
        });
      case "05_추천활동":
        return s.recs.map((a) => ({
          student_id: s.student_id,
          semester: s.semester, // 학기 귀속 (감사 P5-08)
          recommendation_code: a.recommendation_code,
          activity_name: a.name,
          owner: a.owner === "CAREER" ? "진로컨설턴트" : "취업컨설턴트",
          priority: a.priority,
          active: a.active ? "ON" : "OFF",
          counsel_status: OUTREACH_LABELS[statusOf(outreach, s.student_id)],
        }));
      default:
        return [];
    }
  };

  const dataRows = students.flatMap((s) =>
    rowsOf(s).map((row) => cols.map((c) => String(row[c.key] ?? "")))
  );
  return [header, ...dataRows];
}

/** 지정한 key 컬럼들을 헤더·데이터 행에서 통째로 제거 */
function dropColumns(sheetKey: string, rows: string[][], keys: string[]): string[][] {
  const dropIdx = new Set(
    SHEETS[sheetKey].map((c, i) => (keys.includes(c.key) ? i : -1)).filter((i) => i >= 0)
  );
  return dropIdx.size === 0 ? rows : rows.map((r) => r.filter((_, i) => !dropIdx.has(i)));
}

// 상담사 전용 데이터(연락·회차·요약·연계·취업) — 담당자(행정) 다운로드에는 포함 금지 (2026-08-30)
const OUTREACH_KEYS = [
  "outreach_status",
  "outreach_memo",
  "session_count",
  "counsel_summary",
  "referral_stage",
  "referral_agency",
  "employment_status",
  "employer",
  "counsel_status", // 05_추천활동의 상담연계 상태 — 담당자·연구용에서 제거 누락 수정 (감사 P5-03)
];

export function exportSheet(
  sheetKey: string,
  students: StudentRecord[],
  opts: { includeOutreach?: boolean } = {}
): void {
  let rows = buildRows(sheetKey, students);
  if (!opts.includeOutreach) rows = dropColumns(sheetKey, rows, OUTREACH_KEYS);
  downloadCsv(`MJC-READY_${sheetKey}_${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

/**
 * 연구용 익명 추출 — 학번을 익명 일련번호(R001…)로 치환하고 성명을 제거해 내보낸다.
 * 교내 연구 제공은 이 추출본만 사용(투트랙: 운영=실명 / 연구=익명). 동의 화면의
 * "개인을 알아볼 수 없게 처리한 통계는 교내 연구·정책 자료로 활용" 고지가 근거.
 */
/** 익명화 — 학번을 R번호로 치환, 성명·연락처 제거 (투트랙 §7.3)
 *  (2026-09-01 감사 P5-01 수정) 구현이 mock 명단 인덱스 기반이라 실측 데이터에서는 내보내기마다
 *  번호가 바뀌고 중복까지 가능했다 → "추출 세트의 학번 오름차순" 기준 결정론 부여로 교체:
 *   · 같은 추출(같은 필터·기간)에서 시트를 나눠 받아도 같은 학생 = 같은 R번호 → 시트 간 join 가능
 *   · 행 순서도 R번호순 — 실명 CSV와 행 순서 대조로 재식별되는 경로 완화 (감사 P5-14)
 *   ⚠ 추출 세트가 달라지면(학생 추가·필터 변경) 번호가 달라질 수 있음 — 연구 제공은
 *     반드시 한 시점의 추출 세트(전 시트)를 함께 전달할 것 (운영 지침) */
function anonymize(students: StudentRecord[]): StudentRecord[] {
  const sorted = [...students].sort((a, b) => a.student_id.localeCompare(b.student_id));
  return sorted.map((s, i) => ({
    ...s,
    student_id: `R${String(i + 1).padStart(3, "0")}`,
    name: "",
    phone: "",
  }));
}

export function exportSheetForResearch(sheetKey: string, students: StudentRecord[]): void {
  const rows = buildRows(sheetKey, anonymize(students));
  // 식별 가능 컬럼(성명·연락처)과 상담사 전용 컬럼(연락상태·상담메모)은 컬럼 자체를 제거
  const cleaned = dropColumns(sheetKey, rows, ["name", "phone", ...OUTREACH_KEYS]);
  downloadCsv(`MJC-READY_연구용익명_${sheetKey}_${new Date().toISOString().slice(0, 10)}.csv`, cleaned);
}

// ── 통합 다운로드 (2026-09-01 사용자 요구) — 시트별 분할 없이 "1 학생 = 1행" 단일 시트 ──
// 01_학생상태 전체 컬럼 + 검사 실시일 + (01에 없는) 나머지 설문 문항 + 진단 영역점수 +
// 보완영역 + 자격증 요약(상태별) + 추천활동. Long Format 원자료가 필요하면 개별 시트 사용.

function buildIntegratedRows(students: StudentRecord[]): { keys: string[]; rows: string[][] } {
  const outreach = loadOutreach();
  const agencies = loadAgencies();

  const baseCols = SHEETS["01_학생상태"];
  const baseKeys = new Set(baseCols.map((c) => c.key));

  // 01 시트에 아직 없는 설문 문항(배점 2종 + 연구·조건부 문항 등)을 정의 순서대로 뒤에 붙인다
  const allItems = {
    ...(surveyItems.scored_items as Record<string, { label?: string; question?: string; options?: Array<{ value: string; label: string }> }>),
    ...(surveyItems.unscored_items as Record<string, { label?: string; question?: string; options?: Array<{ value: string; label: string }> }>),
  };
  const extraItemKeys = Object.keys(allItems).filter((k) => !baseKeys.has(k));

  const domainEntries = Object.entries(domainLabels);

  const header = [
    ...baseCols.map((c) => c.label),
    "검사 실시일",
    ...extraItemKeys.map((k) => allItems[k].label ?? k),
    ...domainEntries.map(([, label]) => `진단 ${label}`),
    "보완영역",
    "자격증(보유)",
    "자격증(준비 중)",
    "자격증(목표)",
    "추천활동",
  ];

  const certJoin = (s: StudentRecord, status: string): string =>
    s.certs
      .filter((c) => c.status === status)
      .map((c) => {
        const cat = certCategoryLabel((c as { category?: string }).category);
        return cat ? `${c.cert_name}[${cat}]` : c.cert_name;
      })
      .join("; ");

  const rows = students.map((s) => {
    const base = studentStateRow(s, outreach, agencies);
    const domainScores = (s.result as { domainScores?: Record<string, number> }).domainScores ?? {};
    const cells: unknown[] = [
      ...baseCols.map((c) => base[c.key]),
      localDateStr(s.completed_at), // 로컬(KST) 기준 실시일 (감사 P5-05)
      ...extraItemKeys.map((k) => {
        const v = s.survey[k] ?? s.unscored[k];
        return allItems[k].options ? surveyAnswerLabel(k, v) : v ?? "";
      }),
      ...domainEntries.map(([code]) =>
        domainScores[code] != null ? Math.round(domainScores[code] * 100) / 100 : ""
      ),
      s.weak.map((w) => (w as { label?: string }).label ?? "").filter(Boolean).join(" · "),
      certJoin(s, "OWNED"),
      certJoin(s, "PREPARING"),
      certJoin(s, "TARGET"),
      s.recs.map((a) => `${a.priority}. ${a.name}`).join(" / "),
    ];
    return cells.map((v) => String(v ?? ""));
  });

  return { keys: [...baseCols.map((c) => c.key)], rows: [header, ...rows] };
}

/** 통합 컬럼 제거 — 앞쪽 base 구간만 키가 있으므로 그 구간에서 제거 (추가 컬럼은 항상 유지) */
function dropIntegratedColumns(built: { keys: string[]; rows: string[][] }, keys: string[]): string[][] {
  const dropIdx = new Set(built.keys.map((k, i) => (keys.includes(k) ? i : -1)).filter((i) => i >= 0));
  return dropIdx.size === 0 ? built.rows : built.rows.map((r) => r.filter((_, i) => !dropIdx.has(i)));
}

/** 통합 CSV (운영용 실명) — 상담사 전용 컬럼은 기본 제외 (담당자 다운로드 원칙 §6.4) */
export function exportIntegrated(students: StudentRecord[], opts: { includeOutreach?: boolean } = {}): void {
  const built = buildIntegratedRows(students);
  const rows = opts.includeOutreach ? built.rows : dropIntegratedColumns(built, OUTREACH_KEYS);
  downloadCsv(`MJC-READY_통합_${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

/** 통합 CSV (연구용 익명) — R번호 치환 + 성명·연락처·상담사 컬럼 제거 */
export function exportIntegratedForResearch(students: StudentRecord[]): void {
  const built = buildIntegratedRows(anonymize(students));
  const rows = dropIntegratedColumns(built, ["name", "phone", ...OUTREACH_KEYS]);
  downloadCsv(`MJC-READY_통합_연구용익명_${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

export const sheetKeys = Object.keys(SHEETS);
