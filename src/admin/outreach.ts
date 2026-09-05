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

// ── 변경 통지 — 저장·클라우드 동기화 후 열려 있는 화면(명단·헤더 카운트)이 리마운트 없이
//    최신 기록을 다시 읽게 한다. 리마운트 방식은 입력 중이던 상담 카드를 날렸다(감사 C4-07). ──
const changeListeners = new Set<() => void>();
export function onOutreachChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}
export function notifyOutreachChanged(): void {
  changeListeners.forEach((l) => l());
}

export function loadOutreach(): Record<string, OutreachEntry> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, OutreachEntry>;
  } catch {
    return {};
  }
}

/** 공유 저장 결과 — cloudStore.PushResult 재노출 (OK: 공유됨 / LOCAL: 로컬 모드 / FAIL: 공유 실패) */
export type OutreachSaveResult = "OK" | "FAIL" | "LOCAL";

/** 학생 기록 부분 갱신 — 처리자·일시 자동 기록.
 *  (2026-09-01 동시성 수정 — 감사 F01·C4-02) 클라우드 모드에서는 Firestore 트랜잭션으로
 *  "원격 최신 문서"에 변경 필드만 병합해 저장한다 — 다른 상담사가 방금 저장한 회차·연계 기록을
 *  내 로컬 스냅샷이 덮어쓰는 경로 차단. 회차 추가·삭제는 ops로 전달(배열 통째 교체 금지).
 *  결과를 반환하므로 호출 화면은 FAIL을 반드시 사용자에게 표시할 것. */
export async function saveOutreachEntry(
  studentId: string,
  patch: Partial<Omit<OutreachEntry, "updated_at">>,
  by: string,
  ops?: { add?: Omit<CounselSession, "seq">; removeSeq?: number }
): Promise<{ all: Record<string, OutreachEntry>; result: OutreachSaveResult }> {
  const all = loadOutreach();
  const prev = all[studentId] ?? { status: "NONE" as OutreachStatus, memo: "", updated_at: "", by: "" };
  const stamped = { ...patch, updated_at: new Date().toISOString(), by } as Partial<OutreachEntry>;
  // 순환 import 방지 위해 동적 import
  const m = await import("./cloudStore");
  const { result, entry } = await m.pushOutreachMerged(studentId, stamped, ops, prev);
  all[studentId] = entry; // 병합 결과(원격 최신 기반)를 로컬 캐시·화면에 반영
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* localStorage 실패 — 클라우드 반영 결과(result)가 진실 */
  }
  notifyOutreachChanged();
  return { all, result };
}

/** 학번 교정 시 로컬 캐시의 상담 기록 키 이동 (감사 F05 — 클라우드 이동은 responsesSource에서) */
export function moveOutreachLocal(oldId: string, newId: string): void {
  const all = loadOutreach();
  if (!all[oldId]) return;
  if (!all[newId]) all[newId] = all[oldId];
  else {
    // 새 학번에 기록이 이미 있으면 서버(responsesSource)와 같은 규칙으로 병합 — 예전엔 옛 기록을 버려
    // 교정한 화면에서 회차가 누락됐다 (점검 M12). 회차는 합쳐 날짜순 재번호, 나머지는 새 학번 값 우선.
    const src = all[oldId];
    const dst = all[newId];
    const sessions = [...(src.sessions ?? []), ...(dst.sessions ?? [])]
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
      .map((s, i) => ({ ...s, seq: i + 1 }));
    all[newId] = {
      ...src,
      ...dst,
      sessions,
      memo: dst.memo || src.memo,
      final_summary: dst.final_summary || src.final_summary,
      referral: dst.referral ?? src.referral,
      employment: dst.employment ?? src.employment,
    };
  }
  delete all[oldId];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* 캐시 이동 실패는 다음 pull에서 복구 */
  }
  notifyOutreachChanged();
}

/** 응답 삭제 시 로컬 캐시의 상담 기록도 제거 (클라우드 삭제는 responsesSource.deleteStudentResponses) */
export function removeOutreachLocal(studentIds: string[]): void {
  if (studentIds.length === 0) return;
  const all = loadOutreach();
  let changed = false;
  for (const id of studentIds) {
    if (all[id]) {
      delete all[id];
      changed = true;
    }
  }
  if (!changed) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* 캐시 정리 실패는 다음 pull에서 복구 */
  }
  notifyOutreachChanged();
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
