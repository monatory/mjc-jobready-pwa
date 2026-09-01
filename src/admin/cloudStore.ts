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

/** 클라우드에서 공유 데이터를 당겨와 로컬 캐시를 갱신. 성공 시 "CLOUD" */
export async function pullShared(): Promise<CloudState> {
  if (!CLOUD_ENABLED) return "LOCAL";
  try {
    await authReady(); // 로그인 복원 대기
    const db = getDb();
    // 상담 기록 — 원격이 진실(저장이 트랜잭션 병합이므로 원격이 항상 최신 완전본).
    // 원격에 없는 로컬 항목(과거 push 실패분)만 남겨 두어 다음 저장 때 병합되게 한다.
    const localOutreach = JSON.parse(localStorage.getItem(OUTREACH_KEY) ?? "{}") as Record<string, OutreachEntry>;
    const outreachSnap = await getDocs(collection(db, COL.outreach));
    outreachSnap.forEach((d) => {
      localOutreach[d.id] = d.data() as OutreachEntry;
    });
    localStorage.setItem(OUTREACH_KEY, JSON.stringify(localOutreach));
    notifyOutreachChanged(); // 열려 있는 명단·카운트가 리마운트 없이 최신 기록을 읽게 통지

    // 등록부 — id 기준 병합(클라우드 우선) + tombstone(deleted) 전파:
    // 다른 상담사가 삭제한 기관이 내 로컬 캐시에 유령으로 남는 문제(감사 F14) 수정
    const localAgencies = JSON.parse(localStorage.getItem(AGENCY_KEY) ?? "[]") as Agency[];
    const byId = new Map(localAgencies.map((a) => [a.id, a]));
    const agencySnap = await getDocs(collection(db, COL.agencies));
    agencySnap.forEach((d) => {
      const remote = d.data() as Agency & { deleted?: boolean };
      if (remote.deleted) byId.delete(d.id);
      else byId.set(d.id, remote);
    });
    localStorage.setItem(AGENCY_KEY, JSON.stringify([...byId.values()]));
    return "CLOUD";
  } catch {
    return "LOCAL"; // Rules 미배포·오프라인·권한 없음 — 로컬 모드 유지
  }
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
      const seq = sessions.reduce((m, s) => Math.max(m, s.seq), 0) + 1;
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
      const base = snap.exists() ? (snap.data() as OutreachEntry) : fallbackBase;
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

/** 등록부 1건 클라우드 반영 — 결과 반환 (감사 C4-12: 실패 무통보 금지) */
export async function pushAgency(agency: Agency): Promise<PushResult> {
  if (!CLOUD_ENABLED) return "LOCAL";
  try {
    await authReady();
    const db = getDb();
    await runTransaction(db, async (tx) => {
      const ref = doc(db, COL.agencies, agency.id);
      const snap = await tx.get(ref);
      // tombstone된 기관 id의 재사용 방지 — 삭제 마킹이 남아 있으면 되살리지 않는다
      if (snap.exists() && (snap.data() as { deleted?: boolean }).deleted) return;
      tx.set(ref, agency);
    });
    return "OK";
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
      tx.set(ref, { id, deleted: true, updated_at: new Date().toISOString() });
    });
    return "OK";
  } catch {
    return "FAIL";
  }
}
