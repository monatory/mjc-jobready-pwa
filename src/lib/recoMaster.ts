// 추천활동 Master 저장소 — "운영 중엔 Firestore가 진실, JSON은 시드" (CLAUDE.md §4) 실현.
// 관리자 화면에서 등록·수정·삭제·ON/OFF한 내용이 학생 결과지·관리자 명단·워크스페이스에
// 공통 반영되도록, 시드(data/recommendation_master.json) 위에 클라우드 오버라이드를 병합한다.
//
// 병합 규칙:
//  · 시드 활동은 항상 존재 — 같은 코드의 클라우드 문서가 있으면 그 내용으로 대체
//  · 클라우드에만 있는 코드는 신규 활동으로 추가
//  · deleted(tombstone) 문서는 목록에서 제외 (시드 활동 포함 — 문서 삭제 대신 마킹, §7.2.1-9)
//  · 저장 실패는 삼키지 않고 결과("OK"|"FAIL"|"LOCAL")를 반환 (§7.2.1-2)
// 학생 결과지는 익명(student) 세션으로 읽는다 — 조회 실패 시 시드+로컬 캐시로 계산해
// 결과 표시가 막히지 않게 한다(추천이 최신이 아닐 수 있을 뿐, 가짜 데이터는 아님).
import { collection, doc, getDocs, runTransaction } from "firebase/firestore";
import {
  CLOUD_ENABLED,
  COL,
  getDb,
  getStudentAuth,
  getStudentDb,
  authReady,
  authReadyFor,
} from "./firebase";
import { signInAnonymously } from "firebase/auth";
import { recommendationMaster } from "./dataLoader";

export interface RecoActivity {
  recommendation_code: string;
  name: string;
  owner: "CAREER" | "EMPLOYMENT";
  levels: number[];
  weak_domains: string[];
  priority: number;
  student_desc: string;
  active_from: string; // YYYY-MM-DD
  active_to: string;   // YYYY-MM-DD
  active: boolean;
}

/** 클라우드 오버라이드 문서 — 활동 전체 또는 tombstone */
type RecoOverride = (RecoActivity | { recommendation_code: string }) & {
  deleted?: boolean;
  updated_at?: string;
  updated_by?: string;
};

export type RecoPushResult = "OK" | "FAIL" | "LOCAL";
export type RecoPullState = "CLOUD" | "LOCAL" | "FAIL";

const CACHE_KEY = "mjc_ready_reco_master";
const seedActivities = (recommendationMaster as { activities: RecoActivity[] }).activities;
const seedCodes = new Set(seedActivities.map((a) => a.recommendation_code));

/** 코드가 시드(data/recommendation_master.json) 출신인지 — 관리자 표의 출처 배지용 */
export function isSeedCode(code: string): boolean {
  return seedCodes.has(code);
}

// ── 오버라이드 캐시 (localStorage + 모듈 메모리) ──────────────
let overrides: Record<string, RecoOverride> = loadCache();

function loadCache(): Record<string, RecoOverride> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}") as Record<string, RecoOverride>;
  } catch {
    return {};
  }
}

function saveCache(): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(overrides));
  } catch {
    /* 캐시 저장 실패는 치명적이지 않음 — 다음 pull에서 복원 */
  }
}

// 변경 통지 — 열려 있는 관리자 화면이 리마운트 없이 최신 목록을 다시 읽게 (outreach와 동일 패턴)
type Listener = () => void;
const listeners = new Set<Listener>();
export function onRecoMasterChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notifyChanged(): void {
  listeners.forEach((fn) => fn());
}

/** 시드 + 오버라이드 병합 목록 (동기) — 시드 순서 유지, 신규 활동은 코드순으로 뒤에 */
export function getMasterSync(): { activities: RecoActivity[] } {
  const out: RecoActivity[] = [];
  for (const seed of seedActivities) {
    const ov = overrides[seed.recommendation_code];
    if (ov?.deleted) continue;
    out.push(ov ? (ov as RecoActivity) : seed);
  }
  const customs = Object.values(overrides)
    .filter((o): o is RecoActivity & RecoOverride => !o.deleted && !seedCodes.has(o.recommendation_code))
    .sort((a, b) => a.recommendation_code.localeCompare(b.recommendation_code));
  return { activities: [...out, ...customs] };
}

/** 관리자 표 전용 — tombstone 제외 전체 + 출처 구분 없이 편집 대상 목록 (getMasterSync와 동일) */
export function listForAdmin(): RecoActivity[] {
  return getMasterSync().activities;
}

function applyDocs(snap: { forEach(cb: (d: { id: string; data(): unknown }) => void): void }): void {
  const next: Record<string, RecoOverride> = {};
  snap.forEach((d) => {
    next[d.id] = d.data() as RecoOverride;
  });
  overrides = next; // 원격이 진실 — 로컬에만 남은 항목은 폐기 (§7.2.1-1 pull 원칙)
  saveCache();
  notifyChanged();
}

/** 관리자(교직원 세션)용 pull — 화면 진입 시 호출, 상태를 배너로 표시할 것 */
export async function pullRecoMaster(): Promise<RecoPullState> {
  if (!CLOUD_ENABLED) return "LOCAL";
  try {
    await authReady();
    const snap = await getDocs(collection(getDb(), COL.recoMaster));
    applyDocs(snap);
    return "CLOUD";
  } catch {
    return "FAIL"; // 규칙 미게시·오프라인 — 화면이 경고 표시 (조용한 폴백 금지)
  }
}

/** 학생 결과지용 pull — 익명(student) 세션으로 읽기. 실패해도 throw하지 않고 현재 병합본 반환.
 *  타임아웃 동반 — 불안정 네트워크에서 결과지가 "준비 중…"에 고착되지 않게 (감사 S2-01 원칙 준용) */
const STUDENT_PULL_TIMEOUT_MS = 6000;
export async function pullRecoMasterForStudent(): Promise<{ activities: RecoActivity[] }> {
  if (!CLOUD_ENABLED) return getMasterSync();
  try {
    await Promise.race([
      (async () => {
        const auth = getStudentAuth();
        await authReadyFor(auth);
        if (!auth.currentUser) await signInAnonymously(auth);
        const snap = await getDocs(collection(getStudentDb(), COL.recoMaster));
        applyDocs(snap);
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), STUDENT_PULL_TIMEOUT_MS)),
    ]);
  } catch {
    /* 오프라인·규칙 미게시·타임아웃 — 시드+캐시 기준으로 결과 계산 (결과 표시를 막지 않는다) */
  }
  return getMasterSync();
}

/** 활동 등록·수정 (문서키 = recommendation_code). LOCAL 모드에서는 브라우저 캐시에만 반영 */
export async function saveRecoActivity(activity: RecoActivity, editor: string): Promise<RecoPushResult> {
  const docData: RecoOverride = {
    ...activity,
    deleted: false, // 삭제됐던 코드의 재등록은 명시적 관리자 행동이므로 되살림 허용
    updated_at: new Date().toISOString(),
    updated_by: editor,
  };
  const applyLocal = () => {
    overrides[activity.recommendation_code] = docData;
    saveCache();
    notifyChanged();
  };
  if (!CLOUD_ENABLED) {
    applyLocal();
    return "LOCAL";
  }
  try {
    await authReady();
    const db = getDb();
    await runTransaction(db, async (tx) => {
      tx.set(doc(db, COL.recoMaster, activity.recommendation_code), docData);
    });
    applyLocal();
    return "OK";
  } catch {
    return "FAIL"; // 캐시에도 반영하지 않음 — 공유 안 된 변경이 내 화면에만 있는 착시 방지
  }
}

/** 활동 삭제 — tombstone 마킹 (다른 관리자·학생 화면 캐시에 삭제 전파, §7.2.1-9) */
export async function deleteRecoActivity(code: string, editor: string): Promise<RecoPushResult> {
  const tomb: RecoOverride = {
    recommendation_code: code,
    deleted: true,
    updated_at: new Date().toISOString(),
    updated_by: editor,
  };
  const applyLocal = () => {
    overrides[code] = tomb;
    saveCache();
    notifyChanged();
  };
  if (!CLOUD_ENABLED) {
    applyLocal();
    return "LOCAL";
  }
  try {
    await authReady();
    const db = getDb();
    await runTransaction(db, async (tx) => {
      tx.set(doc(db, COL.recoMaster, code), tomb);
    });
    applyLocal();
    return "OK";
  } catch {
    return "FAIL";
  }
}
