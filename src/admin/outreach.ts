// 상담사 아웃리치(연락 관리) — 이 시스템의 존재 이유: 학생이 먼저 오지 않으므로
// 상담사가 먼저 연락한다. 누구에게 연락했고 결과가 무엇인지 학생 단위로 추적한다.
// 시범: localStorage 저장(브라우저별) — 본 구현 시 Firestore studentRecommendations/상담연계 문서로 교체.

export type OutreachStatus = "NONE" | "CONTACTED" | "RESERVED" | "DONE" | "NO_RESPONSE";

export interface OutreachEntry {
  status: OutreachStatus;
  memo: string;
  updated_at: string; // ISO
  by: string;         // 처리한 관리자·상담사 이름
}

export const OUTREACH_LABELS: Record<OutreachStatus, string> = {
  NONE: "미연락",
  CONTACTED: "연락함",
  RESERVED: "상담예약",
  DONE: "상담완료",
  NO_RESPONSE: "무응답",
};

export const OUTREACH_ORDER: OutreachStatus[] = ["NONE", "CONTACTED", "RESERVED", "DONE", "NO_RESPONSE"];

const KEY = "mjc_ready_outreach";

export function loadOutreach(): Record<string, OutreachEntry> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, OutreachEntry>;
  } catch {
    return {};
  }
}

export function saveOutreachEntry(studentId: string, entry: Omit<OutreachEntry, "updated_at">): Record<string, OutreachEntry> {
  const all = loadOutreach();
  all[studentId] = { ...entry, updated_at: new Date().toISOString() };
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* 프로토타입: 저장 실패는 치명적이지 않음 */
  }
  return all;
}

export function statusOf(all: Record<string, OutreachEntry>, studentId: string): OutreachStatus {
  return all[studentId]?.status ?? "NONE";
}
