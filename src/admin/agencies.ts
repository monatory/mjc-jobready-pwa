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

// 클라우드 반영 헬퍼 (설정 전에는 no-op)
const pushCloud = (a: Agency) => void import("./cloudStore").then((m) => m.pushAgency(a));

export function addAgency(input: Omit<Agency, "id" | "created_at">): Agency[] {
  const list = loadAgencies();
  const agency: Agency = {
    ...input,
    id: `ag_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
    created_at: new Date().toISOString(),
  };
  list.push(agency);
  pushCloud(agency);
  return save(list);
}

export function updateAgency(id: string, patch: Partial<Omit<Agency, "id" | "created_at">>): Agency[] {
  const next = loadAgencies().map((a) => (a.id === id ? { ...a, ...patch } : a));
  const updated = next.find((a) => a.id === id);
  if (updated) pushCloud(updated);
  return save(next);
}

export function removeAgency(id: string): Agency[] {
  void import("./cloudStore").then((m) => m.deleteAgencyCloud(id));
  return save(loadAgencies().filter((a) => a.id !== id));
}

export function agencyName(list: Agency[], id: string | undefined): string {
  if (!id) return "";
  return list.find((a) => a.id === id)?.name ?? "";
}
