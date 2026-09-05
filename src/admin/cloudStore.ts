// 상담사 공유 데이터의 클라우드 동기화 — 로컬(localStorage)을 캐시로 유지하고
// Firestore를 공유 원본으로 쓰는 구조 (2026-08-30 도입, 2026-09-01 동시성 전면 수정).
//
// 감사(F01·F04·C4-01·C4-02)에서 확정된 유실 경로의 수정:
//  · 저장은 runTransaction(원격 최신 읽기 → 병합 → 쓰기) — 상담사 A·B가 같은 학생을
//    동시에 편집해도 서로 다른 필드(연락상태 vs 회차)는 절대 서로를 덮어쓰지 않는다.
//  · 회차(sessions) 추가·삭제는 배열 통째 교체가 아니라 "원격 최신 배열 기준 연산"으로 적용.
//  · push 실패는 더 이상 삼키지 않고 결과("OK"|"FAIL"|"LOCAL")를 반환 — 호출 화면이 표시.
//  · pull은 클라우드 우선(원격이 진실) — 클라이언트 시계 비교로 스테일이 이기는 경로 제거.
import { doc, getDocs, collection, runTransaction } from "firebase/firestore";
import { CLOUD_ENABLED, COL, getDb, authReady } from "../lib/firebase";
import { notifyOutreachChanged, type OutreachEntry, type CounselSession } from "./outreach";
import type { Agency } from "./agencies";

export type CloudState = "CLOUD" | "LOCAL";
/** 공유 저장 결과 — OK: 클라우드 반영 / LOCAL: 클라우드 미설정(로컬 모드) / FAIL: 반영 실패(재시도 필요) */
export type PushResult = "OK" | "FAIL" | "LOCAL";

const OUTREACH_KEY = "mjc_ready_outreach";
const AGENCY_KEY = "mjc_ready_agencies";
/** 삭제(tombstone)된 기관의 id→이름 — agencies.agencyName의 폴백 (점검 CON-09). 로그아웃 시 함께 제거 */
export const AGENCY_ARCHIVED_KEY = "mjc_ready_agencies_archived";

/** 클라우드에서 공유 데이터를 당겨와 로컬 캐시를 갱신. 성공 시 "CLOUD" */
export async function pullShared(): Promise<CloudState> {
  if (!CLOUD_ENABLED) return "LOCAL";
  try {
    await authReady(); // 로그인 복원 대기
    const db = getDb();
    // 상담 기록 — 원격이 진실(저장이 트랜잭션 병합이므로 원격이 항상 최신 완전본).
    // (2026-09-05 점검 N2) 예전엔 "원격에 없는 로컬 항목(push 실패분)"을 남겨 두었는데, 실패분은 다음
    // 저장에서 어차피 재병합되지 않고(저장 base는 항상 원격) 삭제된 학생의 기록만 다른 브라우저에 영구히
    // 남아 되살아나는 경로가 됐다. 로컬 캐시를 원격 스냅샷으로 통째 교체한다.
    const remoteOutreach: Record<string, OutreachEntry> = {};
    const outreachSnap = await getDocs(collection(db, COL.outreach));
    let broken = 0;
    outreachSnap.forEach((d) => {
      // 원격 문서 형태 검사 (§7.2.1-11, 점검 C5) — 콘솔 수기 편집 등으로 깨진 문서 1건이 명단·카드
      // 렌더에서 throw 해 화면이 백지가 되던 경로 차단. 깨진 문서는 건너뛰고 건수를 콘솔에 남긴다.
      const clean = sanitizeOutreach(d.data());
      if (clean) remoteOutreach[d.id] = clean;
      else broken += 1;
    });
    if (broken > 0) console.warn(`[MJC-READY] 형식이 깨진 상담 기록 ${broken}건을 건너뛰었습니다 (ready_outreach)`);
    localStorage.setItem(OUTREACH_KEY, JSON.stringify(remoteOutreach));
    notifyOutreachChanged(); // 열려 있는 명단·카운트가 리마운트 없이 최신 기록을 읽게 통지

    // 등록부 — id 기준 병합(클라우드 우선) + tombstone(deleted) 전파:
    // 다른 상담사가 삭제한 기관이 내 로컬 캐시에 유령으로 남는 문제(감사 F14) 수정
    // 등록부 조회만 실패해도 전체를 "미연결"로 표시하던 문제(점검 C7) — 상담 기록이 받아졌으면 CLOUD
    try {
      const localAgencies = JSON.parse(localStorage.getItem(AGENCY_KEY) ?? "[]") as Agency[];
      const byId = new Map(localAgencies.map((a) => [a.id, a]));
      // 삭제된 기관의 이름은 따로 보관 — 과거 연계 기록이 "(삭제된 기관)"만 남고 이름을 잃던 문제 (점검 CON-09)
      const archived: Record<string, string> = {};
      const agencySnap = await getDocs(collection(db, COL.agencies));
      agencySnap.forEach((d) => {
        const remote = d.data() as Agency & { deleted?: boolean };
        if (remote.deleted) {
          byId.delete(d.id);
          if (typeof remote.name === "string" && remote.name) archived[d.id] = remote.name;
        } else if (typeof remote.name === "string" && (remote.type === "AGENCY" || remote.type === "EMPLOYER")) byId.set(d.id, remote);
      });
      localStorage.setItem(AGENCY_KEY, JSON.stringify([...byId.values()]));
      localStorage.setItem(AGENCY_ARCHIVED_KEY, JSON.stringify(archived));
    } catch {
      console.warn("[MJC-READY] 연계기관 등록부 조회 실패 — 로컬 캐시 유지");
    }
    return "CLOUD";
  } catch {
    return "LOCAL"; // Rules 미배포·오프라인·권한 없음 — 로컬 모드 유지
  }
}

const OUTREACH_STATUSES = ["NONE", "CONTACTED", "RESERVED", "DONE", "NO_RESPONSE"];
/** 저장 base가 없을 때(신규 학생·삭제 직후) 쓰는 빈 기록 — 로컬 캐시(옛 데이터)로 부활시키지 않는다 (점검 N2) */
const EMPTY_ENTRY: OutreachEntry = { status: "NONE", memo: "", updated_at: "", by: "" };

/** 상담 기록 문서의 형태 검사 + 정리 — 화면이 그대로 소비하는 필드의 타입을 확인하고, 회차 배열의 깨진
 *  원소(seq가 숫자가 아니거나 내용이 문자열이 아닌 것)는 걸러낸다. 예전엔 배열 여부만 봐서 seq 결측 1건이
 *  이후 모든 회차 번호를 NaN으로 만들었다 (점검 N12). 문서 자체가 아니면 null. */
function sanitizeOutreach(v: unknown): OutreachEntry | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.status !== "string" || !OUTREACH_STATUSES.includes(o.status)) return null;
  if (o.memo !== undefined && typeof o.memo !== "string") return null;
  if (o.sessions !== undefined && !Array.isArray(o.sessions)) return null;
  if (o.referral !== undefined && (typeof o.referral !== "object" || o.referral === null)) return null;
  if (o.employment !== undefined && (typeof o.employment !== "object" || o.employment === null)) return null;
  const entry = { ...(o as unknown as OutreachEntry), memo: typeof o.memo === "string" ? o.memo : "" };
  if (Array.isArray(o.sessions)) {
    const ok = (o.sessions as unknown[]).filter(
      (s): s is CounselSession =>
        !!s && typeof s === "object" && Number.isFinite((s as CounselSession).seq) && typeof (s as CounselSession).content === "string"
    );
    if (ok.length !== o.sessions.length)
      console.warn(`[MJC-READY] 형식이 깨진 상담 회차 ${o.sessions.length - ok.length}건을 건너뛰었습니다`);
    entry.sessions = ok;
  }
  return entry;
}

/** 상담 기록 회차 연산 — 배열 교체 대신 원격 최신 배열에 적용 (동시 편집 시 회차 소실 방지) */
export interface SessionOps {
  add?: Omit<CounselSession, "seq">;
  removeSeq?: number;
}

/**
 * 상담 기록 1건을 트랜잭션으로 병합 저장.
 * 원격 최신 문서를 base로 patch(변경 필드만)와 회차 연산을 적용해 되쓴다.
 * 반환된 병합 결과(entry)를 로컬 캐시·화면에 반영해야 한다.
 */
export async function pushOutreachMerged(
  studentId: string,
  patch: Partial<OutreachEntry>,
  ops: SessionOps | undefined,
  fallbackBase: OutreachEntry
): Promise<{ result: PushResult; entry: OutreachEntry }> {
  const applyTo = (base: OutreachEntry): OutreachEntry => {
    const next: OutreachEntry = { ...base, ...patch };
    if (ops?.add) {
      const sessions = [...(base.sessions ?? [])];
      // seq가 숫자가 아닌 원소가 섞여 있어도 NaN이 전파되지 않게 유한한 값만 본다 (점검 N12)
      const seq = sessions.reduce((m, s) => (Number.isFinite(s.seq) ? Math.max(m, s.seq) : m), 0) + 1;
      sessions.push({ ...ops.add, seq });
      next.sessions = sessions;
    }
    if (ops?.removeSeq != null) {
      next.sessions = (next.sessions ?? base.sessions ?? []).filter((s) => s.seq !== ops.removeSeq);
    }
    return next;
  };

  if (!CLOUD_ENABLED) return { result: "LOCAL", entry: applyTo(fallbackBase) };
  try {
    await authReady();
    const db = getDb();
    const ref = doc(db, COL.outreach, studentId);
    const merged = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      // 원격 문서가 없으면(첫 기록 또는 마스터가 삭제한 직후) 빈 기록에서 시작한다. 로컬 캐시(fallbackBase)를
      // 쓰면 삭제된 학생의 옛 기록이 그대로 부활했다 (점검 N2). 원격 문서는 형태를 정리해 쓴다 (점검 N12).
      const base = snap.exists() ? sanitizeOutreach(snap.data()) ?? EMPTY_ENTRY : EMPTY_ENTRY;
      const next = applyTo(base);
      tx.set(ref, next);
      return next;
    });
    return { result: "OK", entry: merged };
  } catch {
    // 실패 시에도 로컬에는 반영해 입력을 잃지 않되, 호출부가 실패를 사용자에게 표시한다
    return { result: "FAIL", entry: applyTo(fallbackBase) };
  }
}

/** 등록부 1건 클라우드 반영 — 결과 반환 (감사 C4-12: 실패 무통보 금지).
 *  baseUpdatedAt(편집 시작 시점의 원격 갱신 시각)이 오면 원격과 비교해 다를 때 CONFLICT — 남의 수정을
 *  지우지 않는다 (§7.2.1-12, 점검 C4). 원격에 updated_at이 없는 구버전 문서는 비교 없이 쓴다. */
export async function pushAgency(agency: Agency, baseUpdatedAt?: string): Promise<PushResult | "CONFLICT" | "DELETED"> {
  if (!CLOUD_ENABLED) return "LOCAL";
  try {
    await authReady();
    const db = getDb();
    const outcome = await runTransaction(db, async (tx) => {
      const ref = doc(db, COL.agencies, agency.id);
      const snap = await tx.get(ref);
      const remote = snap.exists() ? (snap.data() as Agency & { deleted?: boolean }) : null;
      // tombstone된 기관 id의 재사용 방지 — 삭제 마킹이 남아 있으면 되살리지 않는다.
      // 예전엔 "OK"를 돌려줘 화면이 "수정됨 ✓"을 띄웠다 — 호출부가 삭제 사실을 알리게 DELETED 반환 (점검 CNS-04)
      if (remote?.deleted) return "DELETED" as const;
      if (baseUpdatedAt !== undefined && remote?.updated_at && remote.updated_at !== baseUpdatedAt) return "CONFLICT" as const;
      tx.set(ref, agency);
      return "OK" as const;
    });
    return outcome;
  } catch {
    return "FAIL";
  }
}

/** 등록부 삭제 — 문서를 지우는 대신 tombstone(deleted) 마킹으로 다른 상담사 캐시에 전파 (감사 F14) */
export async function deleteAgencyCloud(id: string): Promise<PushResult> {
  if (!CLOUD_ENABLED) return "LOCAL";
  try {
    await authReady();
    const db = getDb();
    await runTransaction(db, async (tx) => {
      const ref = doc(db, COL.agencies, id);
      // 기관명·구분은 tombstone에 남긴다 — 과거 연계 기록에서 "(삭제된 기관) 서대문고용센터"처럼
      // 이름을 복원하기 위해 (점검 CON-09). 예전엔 id·deleted만 남겨 이름이 영영 사라졌다
      const snap = await tx.get(ref);
      const prev = snap.exists() ? (snap.data() as Partial<Agency>) : {};
      tx.set(ref, {
        id,
        deleted: true,
        updated_at: new Date().toISOString(),
        ...(prev.name ? { name: prev.name } : {}),
        ...(prev.type ? { type: prev.type } : {}),
        ...(prev.program ? { program: prev.program } : {}),
      });
    });
    return "OK";
  } catch {
    return "FAIL";
  }
}
