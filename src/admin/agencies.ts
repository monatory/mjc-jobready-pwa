// 연계기관·취업처 등록부 — 상담사 워크스페이스 전용 공유 자원 (2026-08-30 사용자 요구).
// 외부기관 연계 시 "어느 기관에 보냈는지"를 관리하려면 최소한 기관명·연락처·담당자·사업명이 필요.
// 시범: localStorage — 본 구현 시 Firestore 컬렉션으로 교체(상담사 간 공유).

export type AgencyType = "AGENCY" | "EMPLOYER";

export interface Agency {
  id: string;        // 내부 식별자
  type: AgencyType;  // AGENCY=연계기관(정부사업 등) / EMPLOYER=취업처
  name: string;      // 기관명·회사명
  contact: string;   // 기관 연락처
  manager: string;   // 기관 담당자
  program: string;   // 사업명 (연계기관) / 직무·채용 분야 (취업처)
  note: string;      // 비고
  created_at: string;
}

export const AGENCY_TYPE_LABELS: Record<AgencyType, string> = {
  AGENCY: "연계기관",
  EMPLOYER: "취업처",
};

const KEY = "mjc_ready_agencies";

export function loadAgencies(): Agency[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Agency[];
  } catch {
    return [];
  }
}

function save(list: Agency[]): Agency[] {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* 프로토타입: 저장 실패는 치명적이지 않음 */
  }
  return list;
}

export type AgencySaveResult = "OK" | "FAIL" | "LOCAL";

// 클라우드 반영 헬퍼 (설정 전에는 LOCAL) — 실패를 호출부에 반환 (감사 C4-12: 무통보 금지)
async function pushCloud(a: Agency): Promise<AgencySaveResult> {
  const m = await import("./cloudStore");
  return m.pushAgency(a);
}

export async function addAgency(
  input: Omit<Agency, "id" | "created_at">
): Promise<{ list: Agency[]; result: AgencySaveResult }> {
  const list = loadAgencies();
  const agency: Agency = {
    ...input,
    id: `ag_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
    created_at: new Date().toISOString(),
  };
  const result = await pushCloud(agency);
  // 공유 반영에 실패한 등록은 로컬에도 남기지 않는다 — 남기면 이 브라우저의 연계 select에는 뜨지만
  // 다른 상담사에게는 "(삭제된 기관)"으로 보이는 유령 기관이 된다 (2026-09-02 점검 C10).
  // 호출부는 폼 내용을 유지해 다시 시도할 수 있게 한다.
  if (result === "FAIL") return { list, result };
  list.push(agency);
  return { list: save(list), result };
}

export async function updateAgency(
  id: string,
  patch: Partial<Omit<Agency, "id" | "created_at">>
): Promise<{ list: Agency[]; result: AgencySaveResult }> {
  const next = loadAgencies().map((a) => (a.id === id ? { ...a, ...patch } : a));
  const updated = next.find((a) => a.id === id);
  const result = updated ? await pushCloud(updated) : ("LOCAL" as AgencySaveResult);
  return { list: save(next), result };
}

/** 삭제 — 클라우드에는 tombstone 마킹으로 전파(감사 F14: 다른 상담사 캐시의 유령 기관 방지) */
export async function removeAgency(id: string): Promise<{ list: Agency[]; result: AgencySaveResult }> {
  const m = await import("./cloudStore");
  const result = await m.deleteAgencyCloud(id);
  return { list: save(loadAgencies().filter((a) => a.id !== id)), result };
}

/** 기관명 표시 — 등록부에서 삭제된 기관을 참조하는 과거 연계 기록은 "(삭제된 기관)"으로 표시 (감사 C4-08) */
export function agencyName(list: Agency[], id: string | undefined): string {
  if (!id) return "";
  return list.find((a) => a.id === id)?.name ?? "(삭제된 기관)";
}
