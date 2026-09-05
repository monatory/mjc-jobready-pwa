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
  /** 삭제 시점의 활동 정의 — 과거 추천 이력의 활동명 복원용 (현행 목록에는 포함하지 않음) */
  archived?: RecoActivity;
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

/**
 * 오버라이드 문서가 판정 엔진에 넣어도 안전한 형태인지 실제로 검사.
 * 콘솔 수기 편집·스키마 변경으로 levels가 배열이 아닌 문서 1건만 섞여도
 * resolver의 `a.levels.includes(level)`가 TypeError를 던져 **모든 학생 결과지가 백지**가 되고
 * 관리자 명단은 학생 전원이 "스키마 불일치"로 스킵된다 (2026-09-02 점검 [높음-3]).
 * 서버 규칙만으로는 형태를 강제할 수 없으므로 읽는 쪽에서 방어한다.
 */
function isValidActivity(o: unknown): o is RecoActivity {
  if (!o || typeof o !== "object") return false;
  const a = o as Record<string, unknown>;
  return (
    typeof a.recommendation_code === "string" &&
    a.recommendation_code.length > 0 &&
    typeof a.name === "string" &&
    (a.owner === "CAREER" || a.owner === "EMPLOYMENT") &&
    Array.isArray(a.levels) &&
    a.levels.every((l) => typeof l === "number") &&
    Array.isArray(a.weak_domains) &&
    a.weak_domains.every((d) => typeof d === "string") &&
    typeof a.priority === "number" &&
    typeof a.student_desc === "string" &&
    typeof a.active_from === "string" &&
    typeof a.active_to === "string" &&
    typeof a.active === "boolean"
  );
}

/** 추천 코드 형식 — firestore.rules validReco·RecoMasterPanel CODE_PATTERN과 동일 */
const CODE_RE = /^[A-Z][A-Z0-9_]{2,39}$/;

/** 마지막 병합에서 형태 불량으로 제외된 문서 코드 — 관리자 화면이 경고로 표시 */
let droppedCodes: string[] = [];
/** 문서키 ≠ recommendation_code 로 무시한 문서 id (콘솔 수기 생성분, 점검 RECO-04) */
let mismatchedIds: string[] = [];
export function getDroppedCodes(): string[] {
  return [...droppedCodes, ...mismatchedIds.map((id) => `${id}(문서키≠코드)`)];
}

/** 시드 + 오버라이드 병합 목록 (동기) — 시드 순서 유지, 신규 활동은 코드순으로 뒤에.
 *  형태 불량 오버라이드는 제외하고(시드가 있으면 시드로 폴백) droppedCodes에 기록한다. */
export function getMasterSync(): { activities: RecoActivity[] } {
  const dropped: string[] = [];
  const out: RecoActivity[] = [];
  for (const seed of seedActivities) {
    const ov = overrides[seed.recommendation_code];
    if (ov?.deleted) continue;
    if (!ov) {
      out.push(seed);
    } else if (isValidActivity(ov)) {
      out.push(ov);
    } else {
      dropped.push(seed.recommendation_code);
      out.push(seed); // 깨진 오버라이드는 무시하고 시드 정의를 유지 — 추천이 통째로 사라지지 않게
    }
  }
  const customs: RecoActivity[] = [];
  for (const [code, o] of Object.entries(overrides)) {
    if (o.deleted || seedCodes.has(code)) continue;
    if (isValidActivity(o)) customs.push(o);
    else dropped.push(code); // 시드가 없는 신규 활동은 폴백 대상이 없어 제외만
  }
  customs.sort((a, b) => a.recommendation_code.localeCompare(b.recommendation_code));
  droppedCodes = dropped;
  return { activities: [...out, ...customs] };
}

/** 관리자 표 전용 — tombstone 제외 전체 + 출처 구분 없이 편집 대상 목록 (getMasterSync와 동일) */
export function listForAdmin(): RecoActivity[] {
  return getMasterSync().activities;
}

function applyDocs(snap: { forEach(cb: (d: { id: string; data(): unknown }) => void): void }): void {
  const next: Record<string, RecoOverride> = {};
  const mismatched: string[] = [];
  snap.forEach((d) => {
    const data = d.data() as RecoOverride;
    // 문서키와 recommendation_code가 다르면 어느 쪽이 키인지 알 수 없다 — 규칙(validReco)이 막지만
    // 규칙 게시 전·콘솔 수기 문서는 통과했을 수 있다. 무시하고 관리자 화면에 알린다 (점검 RECO-04)
    if (data && typeof data === "object" && "recommendation_code" in data && data.recommendation_code !== d.id) {
      mismatched.push(d.id);
      return;
    }
    // 문서키가 코드 형식(영대문자 시작·대문자·숫자·_ 3~40자, 규칙 validReco와 동일)이 아니면 제외 — 소문자 코드로
    // 만든 콘솔 문서가 시드(대문자)와 별개 활동으로 중복 등록되던 것 (점검 M10)
    if (!CODE_RE.test(d.id)) {
      mismatched.push(d.id);
      return;
    }
    next[d.id] = data;
  });
  if (mismatched.length > 0)
    console.warn(`[MJC-READY] 문서키와 코드가 다른 추천활동 ${mismatched.length}건 무시: ${mismatched.join(", ")}`);
  mismatchedIds = mismatched;
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
 *  타임아웃 동반 — 불안정 네트워크에서 결과지가 "준비 중…"에 고착되지 않게 (감사 S2-01 원칙 준용).
 *  stale=true는 "최신 목록을 못 받아 시드·캐시로 계산했다"는 뜻 — 결과지가 안내 문구로 표시한다
 *  (조용한 폴백 금지 §7.2.1-3, 2026-09-02 점검 [중간-2]). */
const STUDENT_PULL_TIMEOUT_MS = 6000;
export async function pullRecoMasterForStudent(): Promise<{ activities: RecoActivity[]; stale: boolean }> {
  if (!CLOUD_ENABLED) return { ...getMasterSync(), stale: false }; // 로컬 모드는 시드가 정상 기준
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        const auth = getStudentAuth();
        await authReadyFor(auth);
        if (!auth.currentUser) await signInAnonymously(auth);
        const snap = await getDocs(collection(getStudentDb(), COL.recoMaster));
        applyDocs(snap);
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), STUDENT_PULL_TIMEOUT_MS);
      }),
    ]);
    return { ...getMasterSync(), stale: false };
  } catch {
    // 오프라인·규칙 미게시·타임아웃 — 시드+캐시 기준으로 계산해 결과 표시는 막지 않되 stale로 알린다
    return { ...getMasterSync(), stale: true };
  } finally {
    clearTimeout(timer); // 성공 시에도 타이머 정리
  }
}

/** 저장 결과 — CONFLICT는 "내가 편집을 시작한 뒤 다른 사람이 같은 활동을 바꿨다"는 뜻 */
export type RecoSaveOutcome = { result: RecoPushResult | "CONFLICT"; remote?: RecoActivity };

/**
 * 활동 등록·수정 (문서키 = recommendation_code).
 * 트랜잭션 안에서 **원격 최신본을 먼저 읽어** 편집 시작 시점(baseUpdatedAt)과 비교한다:
 * 그 사이 누군가 같은 활동을 바꿨으면 덮어쓰지 않고 CONFLICT를 반환해 화면이 알린다
 * (§7.2.1-1 트랜잭션 병합 원칙 — 2026-09-02 점검 [높음-2] 수정).
 * isNew(신규 등록 폼)면 기존 문서가 있을 때 CONFLICT. 수정·ON/OFF는 baseUpdatedAt과 원격을 비교한다.
 * (2026-09-03 점검 A9) "신규 여부"를 baseUpdatedAt 결측으로 추정하지 않는다 — updated_at이 없는
 * 오버라이드(콘솔 수기 문서)를 수정·ON/OFF하면 항상 신규로 오인돼 CONFLICT가 났고, "최신 내용
 * 불러오기"로도 풀리지 않았다. 원격에 updated_at이 없으면 비교할 기준이 없으므로 그대로 쓴다.
 */
export async function saveRecoActivity(
  activity: RecoActivity,
  editor: string,
  opts: { isNew: boolean; baseUpdatedAt?: string }
): Promise<RecoSaveOutcome> {
  const { isNew, baseUpdatedAt } = opts;
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
    return { result: "LOCAL" };
  }
  try {
    await authReady();
    const db = getDb();
    const ref = doc(db, COL.recoMaster, activity.recommendation_code);
    const conflict = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const remote = snap.exists() ? (snap.data() as RecoOverride) : null;
      // 신규 등록인데 이미 문서가 있음(다른 관리자가 선점, 또는 과거 삭제분) → 덮어쓰지 않는다
      if (isNew && remote && !remote.deleted) return remote;
      // 삭제된 활동은 수정·ON/OFF 경로로 조용히 되살아나면 안 된다. 되살리기는 "신규 등록" 폼에서
      // 같은 코드를 명시적으로 다시 입력할 때만 허용 — 2026-09-02 점검 CON-07.
      if (remote && remote.deleted && !isNew) return remote;
      // 수정인데 내가 읽은 이후 원격이 바뀜 → 남의 수정을 지우지 않는다
      if (!isNew && remote && remote.updated_at && remote.updated_at !== baseUpdatedAt) return remote;
      tx.set(ref, docData);
      return null;
    });
    if (conflict) {
      return { result: "CONFLICT", remote: isValidActivity(conflict) ? conflict : undefined };
    }
    applyLocal();
    return { result: "OK" };
  } catch {
    return { result: "FAIL" }; // 캐시에도 반영하지 않음 — 공유 안 된 변경이 내 화면에만 있는 착시 방지
  }
}

/**
 * 활동 삭제 — tombstone 마킹 (다른 관리자·학생 화면 캐시에 삭제 전파, §7.2.1-9).
 * 삭제 시점의 활동 정의(archived)를 함께 보존한다 — 과거 학생이 추천받은 활동이 삭제돼도
 * 명단·CSV에서 활동명을 복원할 수 있게 (2026-09-02 점검 [중간-1]).
 */
export async function deleteRecoActivity(
  code: string,
  editor: string,
  baseUpdatedAt?: string
): Promise<RecoPushResult | "CONFLICT"> {
  const local = getMasterSync().activities.find((a) => a.recommendation_code === code);
  const makeTomb = (archived: RecoActivity | undefined): RecoOverride => ({
    recommendation_code: code,
    deleted: true,
    archived,
    updated_at: new Date().toISOString(),
    updated_by: editor,
  });
  const applyLocal = (tomb: RecoOverride) => {
    overrides[code] = tomb;
    saveCache();
    notifyChanged();
  };
  if (!CLOUD_ENABLED) {
    applyLocal(makeTomb(local));
    return "LOCAL";
  }
  try {
    await authReady();
    const db = getDb();
    const ref = doc(db, COL.recoMaster, code);
    // 저장과 동일하게 원격 최신본을 먼저 읽는다 (§7.2.1-12).
    //  · 내가 읽은 뒤 다른 관리자가 수정했으면 CONFLICT — 무경고 삭제 금지
    //  · archived에는 **원격 최신 정의**를 보존 — 낡은 로컬 정의를 박제하지 않는다
    // (2026-09-02 점검 RECO-02)
    const outcome = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const remote = snap.exists() ? (snap.data() as RecoOverride) : null;
      if (remote?.deleted) return "ALREADY" as const; // 이미 삭제됨 — 재삭제는 무해, 성공 처리
      if (baseUpdatedAt && remote?.updated_at && remote.updated_at !== baseUpdatedAt) return "CONFLICT" as const;
      const archived = remote && isValidActivity(remote) ? remote : local;
      const tomb = makeTomb(archived);
      tx.set(ref, tomb);
      return tomb;
    });
    if (outcome === "CONFLICT") return "CONFLICT";
    if (outcome === "ALREADY") {
      applyLocal(makeTomb(local));
      return "OK";
    }
    applyLocal(outcome);
    return "OK";
  } catch {
    return "FAIL";
  }
}

/** 삭제된 활동을 포함한 정의 조회 — 과거 추천 스냅샷의 활동명 복원용 (이력 표시 전용).
 *  현행 목록(getMasterSync)에는 절대 포함하지 않는다 — 삭제된 활동이 새로 추천되면 안 되므로. */
export function findArchivedActivity(code: string): RecoActivity | undefined {
  const ov = overrides[code];
  if (ov?.deleted && ov.archived && isValidActivity(ov.archived)) return ov.archived;
  return seedActivities.find((a) => a.recommendation_code === code);
}

/** 편집 충돌 판정에 쓰는 원격 갱신 시각 — 화면이 편집 시작 시점 값을 보관했다가 저장 때 전달 */
export function updatedAtOf(code: string): string | undefined {
  return overrides[code]?.updated_at;
}
