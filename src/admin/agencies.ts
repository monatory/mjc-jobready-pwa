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
  updated_at?: string; // 마지막 수정 시각 — 편집 충돌 감지 기준 (§7.2.1-12, 점검 C4). 구버전 문서는 없음
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

/** CONFLICT: 내가 편집을 시작한 뒤 다른 상담사가 같은 기관을 수정함 — 덮어쓰지 않았으니 최신본을 다시 봐야 한다
 *  DELETED: 수정하려는 기관을 다른 상담사가 이미 삭제함 — 저장하지 않았고 로컬 목록에서도 제거 (점검 CNS-04) */
export type AgencySaveResult = "OK" | "FAIL" | "LOCAL" | "CONFLICT" | "DELETED";

// 클라우드 반영 헬퍼 (설정 전에는 LOCAL) — 실패를 호출부에 반환 (감사 C4-12: 무통보 금지)
async function pushCloud(a: Agency, baseUpdatedAt?: string): Promise<AgencySaveResult> {
  const m = await import("./cloudStore");
  return m.pushAgency(a, baseUpdatedAt);
}

export async function addAgency(
  input: Omit<Agency, "id" | "created_at" | "updated_at">
): Promise<{ list: Agency[]; result: AgencySaveResult }> {
  const list = loadAgencies();
  const now = new Date().toISOString();
  const agency: Agency = {
    ...input,
    id: `ag_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
    created_at: now,
    updated_at: now,
  };
  const result = await pushCloud(agency);
  // 공유 반영에 실패한 등록은 로컬에도 남기지 않는다 — 남기면 이 브라우저의 연계 select에는 뜨지만
  // 다른 상담사에게는 "(삭제된 기관)"으로 보이는 유령 기관이 된다 (2026-09-02 점검 C10).
  // 호출부는 폼 내용을 유지해 다시 시도할 수 있게 한다.
  if (result === "FAIL") return { list, result };
  list.push(agency);
  return { list: save(list), result };
}

/** 수정 — 읽기→비교→쓰기 (§7.2.1-12, 점검 C4): 편집 시작 시점의 updated_at을 원격과 비교해 다르면
 *  CONFLICT를 돌려주고 로컬도 바꾸지 않는다. 예전엔 로컬 캐시 기준 전체 덮어쓰기였다. */
export async function updateAgency(
  id: string,
  patch: Partial<Omit<Agency, "id" | "created_at" | "updated_at">>,
  baseUpdatedAt?: string
): Promise<{ list: Agency[]; result: AgencySaveResult }> {
  const current = loadAgencies();
  const target = current.find((a) => a.id === id);
  if (!target) return { list: current, result: "LOCAL" };
  const updated: Agency = { ...target, ...patch, updated_at: new Date().toISOString() };
  const result = await pushCloud(updated, baseUpdatedAt);
  if (result === "CONFLICT") return { list: current, result };
  // 다른 상담사가 이미 삭제한 기관 — 되살리지 않고 내 로컬 목록에서도 지운다 (점검 CNS-04)
  if (result === "DELETED") return { list: save(current.filter((a) => a.id !== id)), result };
  return { list: save(current.map((a) => (a.id === id ? updated : a))), result };
}

const ARCHIVED_KEY = "mjc_ready_agencies_archived";

/** 삭제된 기관 id→이름 (cloudStore.pullShared가 tombstone에서 채움) — 없으면 빈 객체 */
function loadArchivedNames(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(ARCHIVED_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

/** 삭제 — 클라우드에는 tombstone 마킹으로 전파(감사 F14: 다른 상담사 캐시의 유령 기관 방지).
 *  삭제한 세션에서도 과거 연계 기록에 이름이 남도록 로컬 archived 캐시에 즉시 기록한다 — 예전엔 다음
 *  pullShared(재로그인) 전까지 "(삭제된 기관)"만 보였다 (점검 N11). 로컬 모드에서도 같은 캐시를 쓴다. */
export async function removeAgency(id: string): Promise<{ list: Agency[]; result: AgencySaveResult }> {
  const current = loadAgencies();
  const target = current.find((a) => a.id === id);
  if (target?.name) {
    try {
      localStorage.setItem(ARCHIVED_KEY, JSON.stringify({ ...loadArchivedNames(), [id]: target.name }));
    } catch {
      /* 캐시 기록 실패는 다음 pull에서 복구 */
    }
  }
  const m = await import("./cloudStore");
  const result = await m.deleteAgencyCloud(id);
  return { list: save(current.filter((a) => a.id !== id)), result };
}

/** 기관명 표시 — 등록부에서 삭제된 기관을 참조하는 과거 연계 기록은 "(삭제된 기관) 이름"으로 표시.
 *  tombstone이 이름을 보존하므로(점검 CON-09) 이름까지 잃지 않는다. 구버전 tombstone은 이름 없이 표시 (감사 C4-08) */
export function agencyName(list: Agency[], id: string | undefined): string {
  if (!id) return "";
  const live = list.find((a) => a.id === id)?.name;
  if (live) return live;
  const archived = loadArchivedNames()[id];
  return archived ? `(삭제된 기관) ${archived}` : "(삭제된 기관)";
}
