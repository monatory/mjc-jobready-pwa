// Excel용 CSV 내보내기 — 컬럼 정의는 data/excel_columns.json에서 주입 (하드코딩 금지).
// UTF-8 BOM으로 Excel 한글 호환. 시범: Sheet별 CSV 파일 / 본 구현: xlsx 다중 시트 1파일(제안 12건-⑥).
import excelColumnsJson from "../../data/excel_columns.json";
import { surveyItems } from "../lib/dataLoader";
import { mockStudents, surveyAnswerLabel, type StudentRecord } from "./mockStudents";
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
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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

/** Sheet 정의 → 학생 레코드 배열을 행으로 평탄화 */
function buildRows(sheetKey: string, students: StudentRecord[]): string[][] {
  const cols = SHEETS[sheetKey];
  const header = cols.map((c) => c.label);
  const outreach = loadOutreach(); // 상담사 기록 — 내보내기 시점 스냅샷
  const agencies = loadAgencies();

  const rowsOf = (s: StudentRecord): Array<Record<string, unknown>> => {
    switch (sheetKey) {
      case "01_학생상태":
        return [
          {
            student_id: s.student_id,
            name: s.name,
            dept: s.dept,
            grade: s.grade,
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
          },
        ];
      case "02_설문원자료":
        return Object.entries({ ...s.survey, ...s.unscored }).map(([itemKey, v]) => ({
          student_id: s.student_id,
          semester: s.semester,
          item_key: itemKey,
          answer_value: v,
          answer_label: surveyAnswerLabel(itemKey, v),
          answered_at: s.completed_at,
          updated_at: s.completed_at,
          survey_version: (surveyItems as { version: string }).version,
        }));
      case "03_자격증현황":
        return s.certs.map((c) => ({
          student_id: s.student_id,
          cert_name: c.cert_name,
          category: certCategoryLabel((c as { category?: string }).category),
          status: c.status === "OWNED" ? "보유" : c.status === "PREPARING" ? "준비 중" : "목표",
          target_or_acquired_date: "",
          memo: "",
        }));
      case "04_진단점수":
        return Object.entries(s.diag).map(([qid, v]) => ({
          student_id: s.student_id,
          semester: s.semester,
          question_id: qid,
          domain: qid.slice(0, 2),
          raw_score: v,
          domain_avg: "",
          gate_passed: s.result.gates.employment && s.result.gates.timing ? "Y" : "N",
          critical_unmet: s.result.gates.level4_signals.required_ok ? "N" : "Y",
          diagnostic_version: "MJC-CDI-0.1-draft",
        }));
      case "05_추천활동":
        return s.recs.map((a) => ({
          student_id: s.student_id,
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
export function exportSheetForResearch(sheetKey: string, students: StudentRecord[]): void {
  // 익명 일련번호는 전체 명단 기준으로 고정 — 필터 명단·시트별 내보내기 사이에서도
  // 같은 학생 = 같은 R번호가 유지되어야 연구자가 시트 간 결합(join) 가능.
  // (Firestore 연동 시 전체 로스터 기준 결정론적 매핑으로 교체)
  const anonIndex = new Map(mockStudents.map((s, i) => [s.student_id, i]));
  const anonymized = students.map((s, i) => ({
    ...s,
    student_id: `R${String((anonIndex.get(s.student_id) ?? i) + 1).padStart(3, "0")}`,
    name: "",
    phone: "",
  }));
  const rows = buildRows(sheetKey, anonymized);
  // 식별 가능 컬럼(성명·연락처)과 상담사 전용 컬럼(연락상태·상담메모)은 컬럼 자체를 제거
  const cleaned = dropColumns(sheetKey, rows, ["name", "phone", ...OUTREACH_KEYS]);
  downloadCsv(`MJC-READY_연구용익명_${sheetKey}_${new Date().toISOString().slice(0, 10)}.csv`, cleaned);
}

export const sheetKeys = Object.keys(SHEETS);
