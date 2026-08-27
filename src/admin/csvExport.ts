// Excel용 CSV 내보내기 — 컬럼 정의는 data/excel_columns.json에서 주입 (하드코딩 금지).
// UTF-8 BOM으로 Excel 한글 호환. 시범: Sheet별 CSV 파일 / 본 구현: xlsx 다중 시트 1파일(제안 12건-⑥).
import excelColumnsJson from "../../data/excel_columns.json";
import { surveyItems } from "../lib/dataLoader";
import { surveyAnswerLabel, type StudentRecord } from "./mockStudents";

type ColumnDef = { key: string; label: string };
const SHEETS = excelColumnsJson.sheets as Record<string, ColumnDef[]>;

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

  const rowsOf = (s: StudentRecord): Array<Record<string, unknown>> => {
    switch (sheetKey) {
      case "01_학생상태":
        return [
          {
            student_id: s.student_id,
            name: s.name,
            dept: s.dept,
            grade: s.grade,
            semester: s.semester,
            career_direction: surveyAnswerLabel("career_direction", s.survey.career_direction),
            jas: s.result.jas,
            jrs: s.result.jrs ?? "",
            cds: s.result.cds ?? "",
            level: s.result.level,
            route_tag: s.result.routeTag,
            employment_timing: surveyAnswerLabel("employment_timing", s.survey.employment_timing),
            desired_job: s.unscored.desired_job ?? "",
            region: surveyAnswerLabel("region", s.unscored.region),
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
          category: "",
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
          counsel_status: "미연계",
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

export function exportSheet(sheetKey: string, students: StudentRecord[]): void {
  downloadCsv(`MJC-READY_${sheetKey}_${new Date().toISOString().slice(0, 10)}.csv`, buildRows(sheetKey, students));
}

export const sheetKeys = Object.keys(SHEETS);
