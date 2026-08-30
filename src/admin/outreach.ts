// 상담사 학생 기록(아웃리치+상담 카드) — 이 시스템의 존재 이유: 학생이 먼저 오지 않으므로
// 상담사가 먼저 연락하고, 연락→상담(회차)→외부기관 연계→사후관리→취업까지 전 과정을
// 학생 단위로 추적한다. 상담사 워크스페이스(#/counsel) 전용 — 담당자(행정) 비노출(§6.4).
// 시범: localStorage 저장(브라우저별) — 본 구현 시 Firestore 문서로 교체(상담사 간 실시간 공유).

export type OutreachStatus = "NONE" | "CONTACTED" | "RESERVED" | "DONE" | "NO_RESPONSE";
export type ReferralStage = "NONE" | "WANTED" | "REFERRED" | "FOLLOWUP" | "CLOSED";
export type EmploymentStatus = "NONE" | "SEEKING" | "EMPLOYED" | "FURTHER_STUDY" | "STARTUP" | "ETC";

/** 상담 회차 기록 — 1회차, 2회차… 누적 */
export interface CounselSession {
  seq: number;      // 회차 (1부터)
  date: string;     // YYYY-MM-DD
  content: string;  // 상담 내용
  by: string;       // 상담사 이름
}

/** 외부기관 연계 — 희망 → 연계 완료 → 사후관리 → 종결 파이프라인 */
export interface Referral {
  stage: ReferralStage;
  agency_id?: string;   // agencies.ts 등록부 참조
  referred_at?: string; // 연계일 YYYY-MM-DD
  note?: string;        // 연계 메모 (진행 상황)
}

/** 취업상태 등록 */
export interface Employment {
  status: EmploymentStatus;
  employer?: string;    // 취업처명 (취업 시)
  date?: string;        // 취업(확정)일 YYYY-MM-DD
  note?: string;
}

export interface OutreachEntry {
  status: OutreachStatus;       // 연락 상태
  memo: string;                 // 간단 메모
  sessions?: CounselSession[];  // 상담 회차 기록
  final_summary?: string;       // 최종 요약
  referral?: Referral;          // 외부기관 연계
  employment?: Employment;      // 취업상태
  updated_at: string;           // ISO
  by: string;                   // 마지막 처리자
}

export const OUTREACH_LABELS: Record<OutreachStatus, string> = {
  NONE: "미연락",
  CONTACTED: "연락함",
  RESERVED: "상담예약",
  DONE: "상담완료",
  NO_RESPONSE: "무응답",
};
export const OUTREACH_ORDER: OutreachStatus[] = ["NONE", "CONTACTED", "RESERVED", "DONE", "NO_RESPONSE"];

export const REFERRAL_LABELS: Record<ReferralStage, string> = {
  NONE: "해당 없음",
  WANTED: "연계 희망",
  REFERRED: "연계 완료",
  FOLLOWUP: "사후관리 중",
  CLOSED: "종결",
};
export const REFERRAL_ORDER: ReferralStage[] = ["NONE", "WANTED", "REFERRED", "FOLLOWUP", "CLOSED"];

export const EMPLOYMENT_LABELS: Record<EmploymentStatus, string> = {
  NONE: "미등록",
  SEEKING: "구직 중",
  EMPLOYED: "취업",
  FURTHER_STUDY: "진학",
  STARTUP: "창업",
  ETC: "기타",
};
export const EMPLOYMENT_ORDER: EmploymentStatus[] = ["NONE", "SEEKING", "EMPLOYED", "FURTHER_STUDY", "STARTUP", "ETC"];

const KEY = "mjc_ready_outreach";

export function loadOutreach(): Record<string, OutreachEntry> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, OutreachEntry>;
  } catch {
    return {};
  }
}

/** 학생 기록 부분 갱신(merge) — 처리자·일시 자동 기록 */
export function saveOutreachEntry(
  studentId: string,
  patch: Partial<Omit<OutreachEntry, "updated_at">>,
  by: string
): Record<string, OutreachEntry> {
  const all = loadOutreach();
  const prev = all[studentId] ?? { status: "NONE" as OutreachStatus, memo: "", updated_at: "", by: "" };
  all[studentId] = { ...prev, ...patch, updated_at: new Date().toISOString(), by };
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* 프로토타입: 저장 실패는 치명적이지 않음 */
  }
  // 클라우드 공유 저장소에도 반영 (설정 전에는 no-op) — 순환 import 방지 위해 동적 import
  void import("./cloudStore").then((m) => m.pushOutreach(studentId, all[studentId]));
  return all;
}

export function statusOf(all: Record<string, OutreachEntry>, studentId: string): OutreachStatus {
  return all[studentId]?.status ?? "NONE";
}

export function referralStageOf(all: Record<string, OutreachEntry>, studentId: string): ReferralStage {
  return all[studentId]?.referral?.stage ?? "NONE";
}

export function employmentStatusOf(all: Record<string, OutreachEntry>, studentId: string): EmploymentStatus {
  return all[studentId]?.employment?.status ?? "NONE";
}
