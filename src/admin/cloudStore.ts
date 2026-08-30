// 상담사 공유 데이터의 클라우드 동기화 — 로컬(localStorage)을 캐시로 유지하고
// Firestore를 공유 원본으로 쓰는 write-through 구조 (2026-08-30, Firebase 프로젝트 분리 결정).
//  - CLOUD_ENABLED=false(설정 전)이면 아무것도 하지 않음 → 완전한 로컬 모드
//  - 워크스페이스 진입 시 pullShared()로 클라우드 → 로컬 병합(최신 우선)
//  - 저장 시 outreach.ts/agencies.ts가 push*()를 fire-and-forget 호출
// 읽기 화면들은 지금처럼 동기 API(loadOutreach 등)만 쓰면 된다.
import { doc, setDoc, getDocs, collection, deleteDoc } from "firebase/firestore";
import { CLOUD_ENABLED, COL, getDb, authReady } from "../lib/firebase";
import type { OutreachEntry } from "./outreach";
import type { Agency } from "./agencies";

export type CloudState = "CLOUD" | "LOCAL";

const OUTREACH_KEY = "mjc_ready_outreach";
const AGENCY_KEY = "mjc_ready_agencies";

/** 클라우드에서 공유 데이터를 당겨와 로컬 캐시에 병합. 성공 시 "CLOUD" */
export async function pullShared(): Promise<CloudState> {
  if (!CLOUD_ENABLED) return "LOCAL";
  try {
    await authReady(); // 로그인 복원 대기
    const db = getDb();
    // 상담 기록 — 학생별 updated_at 최신 우선 병합
    const localOutreach = JSON.parse(localStorage.getItem(OUTREACH_KEY) ?? "{}") as Record<string, OutreachEntry>;
    const outreachSnap = await getDocs(collection(db, COL.outreach));
    outreachSnap.forEach((d) => {
      const remote = d.data() as OutreachEntry;
      const local = localOutreach[d.id];
      if (!local || (remote.updated_at ?? "") >= (local.updated_at ?? "")) localOutreach[d.id] = remote;
    });
    localStorage.setItem(OUTREACH_KEY, JSON.stringify(localOutreach));

    // 등록부 — id 기준 병합(클라우드 우선)
    const localAgencies = JSON.parse(localStorage.getItem(AGENCY_KEY) ?? "[]") as Agency[];
    const byId = new Map(localAgencies.map((a) => [a.id, a]));
    const agencySnap = await getDocs(collection(db, COL.agencies));
    agencySnap.forEach((d) => byId.set(d.id, d.data() as Agency));
    localStorage.setItem(AGENCY_KEY, JSON.stringify([...byId.values()]));
    return "CLOUD";
  } catch {
    return "LOCAL"; // Rules 미배포·오프라인·권한 없음 — 로컬 모드 유지
  }
}

/** 상담 기록 1건 클라우드 반영 (실패 무시 — 로컬이 항상 진실 캐시) */
export function pushOutreach(studentId: string, entry: OutreachEntry): void {
  if (!CLOUD_ENABLED) return;
  setDoc(doc(getDb(), COL.outreach, studentId), entry).catch(() => {});
}

/** 등록부 1건 클라우드 반영 */
export function pushAgency(agency: Agency): void {
  if (!CLOUD_ENABLED) return;
  setDoc(doc(getDb(), COL.agencies, agency.id), agency).catch(() => {});
}

export function deleteAgencyCloud(id: string): void {
  if (!CLOUD_ENABLED) return;
  deleteDoc(doc(getDb(), COL.agencies, id)).catch(() => {});
}
