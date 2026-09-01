// 관리자·상담사 화면의 학생 데이터 소스 — 클라우드 모드는 실측(Firestore ready_responses)만 표시.
// 실측 문서의 "원응답"을 저장된 스냅샷이 아니라 판정 엔진으로 다시 계산해 표시한다(결정론 §3.1-②).
// (2026-09-01 감사 수정) 클라우드 모드에서 mock 폴백 금지 — 빈 DB는 "0건", 조회 실패는 "ERROR"로
// 구분 표시한다. 가짜 학생 40명이 실측처럼 떠서 실제 아웃리치 기록이 오염되던 경로(F07) 차단.
import { useEffect, useState } from "react";
import { collection, getDocs, doc, runTransaction } from "firebase/firestore";
import { CLOUD_ENABLED, COL, SEMESTER, getDb, getAuthInst, authReady } from "../lib/firebase";
import { evaluate, type EvaluationResult } from "../../lib/level_engine.js";
import { findWeakAreas } from "../../lib/weak_area.js";
import { resolveRecommendations, type RecommendationActivity } from "../../lib/recommendation_resolver.js";
import { surveyItems, diagnosticBank, levelRules } from "../lib/dataLoader";
import { getMasterSync } from "../lib/recoMaster"; // 시드+관리자 등록분 병합 (§4: 운영 중엔 Firestore가 진실)
import { localDateStr, todayStr } from "../lib/dates";
import { mockStudents, type StudentRecord } from "./mockStudents";
import { moveOutreachLocal } from "./outreach";
import type { ResponsePayload } from "../lib/saveResponse";

export type StudentsSource = "CLOUD" | "MOCK" | "LOADING" | "ERROR";
export interface StudentsData {
  students: StudentRecord[];
  source: StudentsSource;
  /** 스키마 불일치로 판정 불가해 제외된 실측 문서 수 — 배너에 표시(무음 스킵 금지, 감사 ENG-02) */
  skipped?: number;
}

const MOCK: StudentsData = { students: mockStudents, source: "MOCK" };

/** 기간(검사 실시일, YYYY-MM-DD) 포함 여부 — 관리자 집계·명단 상세 필터 공용 (2026-08-31)
 *  from/to가 모두 비면 전체 포함. 기간이 설정됐는데 실시일이 없는 레코드는 제외(귀속 불가).
 *  실시일은 로컬(KST) 기준 — UTC slice로 새벽 제출이 전날 귀속되던 문제 수정 (감사 P3-01). */
export function inPeriod(s: StudentRecord, from: string, to: string): boolean {
  if (!from && !to) return true;
  const d = localDateStr(s.completed_at);
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}
// 클라우드 조회가 끝나기 전 표시 상태 — mock이 먼저 그려졌다 실측으로 바뀌는
// "잠깐 다른 데이터가 떴다 사라지는" 깜빡임 방지 (2026-08-31 사용자 보고)
const LOADING: StudentsData = { students: [], source: "LOADING" };

/** 결과 시점 추천 스냅샷(코드 배열) 복원 — 활성기간이 지나도 "그때 추천했던 활동" 유지 (감사 P3-11).
 *  스냅샷이 없는 구버전 응답은 현행 규칙으로 재계산(오늘 날짜 기준). */
function restoreRecs(raw: ResponsePayload, level: number, weak: ReturnType<typeof findWeakAreas>): RecommendationActivity[] {
  const master = getMasterSync() as unknown as { activities: RecommendationActivity[] };
  const codes = raw.recommendations;
  if (Array.isArray(codes) && codes.length > 0) {
    const found = codes
      .map((c) => master.activities.find((a) => a.recommendation_code === c))
      .filter((a): a is RecommendationActivity => Boolean(a));
    if (found.length > 0) return found;
  }
  return resolveRecommendations(level, weak, master, { today: todayStr() });
}

function toStudentRecord(raw: ResponsePayload & { saved_at?: string }): StudentRecord {
  const result = evaluate(raw.survey, raw.diag, { surveyItems, diagnosticBank, levelRules }) as EvaluationResult;
  const weak = findWeakAreas(
    result.domainScores,
    diagnosticBank,
    (levelRules as unknown as { weak_area: { threshold: number; max_count: number } }).weak_area
  );
  const recs = restoreRecs(raw, result.level, weak);
  return {
    student_id: raw.profile.student_id,
    name: raw.profile.name,
    dept: raw.profile.dept,
    grade: raw.profile.grade,
    phone: raw.profile.phone ?? "",
    semester: (raw as { semester?: string }).semester ?? "",
    survey: raw.survey,
    unscored: raw.unscored ?? {},
    certs: raw.certs ?? [],
    diag: raw.diag,
    result,
    weak,
    recs,
    completed_at: raw.saved_at ?? "",
  };
}

let cache: Promise<StudentsData> | null = null;
let lastKnown: StudentsData | null = null; // 조회 완료 결과 — 화면 전환 시 동기 재사용(깜빡임 없음)

async function fetchStudents(): Promise<StudentsData> {
  if (!CLOUD_ENABLED) return MOCK; // 미리보기(mock)는 클라우드 설정 전에만
  try {
    await authReady(); // 새로고침 시 로그인 복원 대기 — 복원 전 조회는 권한 거부됨
    const snap = await getDocs(collection(getDb(), COL.responses));
    const students: StudentRecord[] = [];
    let skipped = 0;
    snap.forEach((d) => {
      try {
        students.push(toStudentRecord(d.data() as ResponsePayload));
      } catch {
        skipped += 1; // 스키마 불일치 — 무음 삭제 대신 집계해 배너에 표시
      }
    });
    return { students, source: "CLOUD", skipped };
  } catch {
    // 미로그인·Rules 미배포·쿼터 초과 — mock으로 위장하지 않고 오류 상태를 그대로 표시
    return { students: [], source: "ERROR" };
  }
}

/** 세션당 1회 조회 캐시 — 로그인·로그아웃 시 무효화(권한이 바뀌므로 재조회 필요) */
export function fetchStudentsCached(): Promise<StudentsData> {
  return (cache ??= fetchStudents().then((d) => (lastKnown = d)));
}

const listeners = new Set<() => void>();
export function invalidateStudentsCache(): void {
  cache = null;
  lastKnown = null;
  listeners.forEach((l) => l());
}

/** 학생 프로필 교정 (2026-08-31 사용자 요구 — 학생이 학번·이름·연락처를 잘못 입력하는 경우 상담사가 수정)
 *  실측(Firestore) 문서의 profile만 고쳐 저장한다. 응답·판정에 쓰이는 값(survey/diag)과
 *  검사 실시일(saved_at)은 건드리지 않는다.
 *  (2026-09-01 감사 수정 F05·F06)
 *   · 키 이동(읽기→중복검사→복사→삭제)을 runTransaction으로 원자화 — 교정 도중 학생 재제출·
 *     다른 관리자의 동시 교정과 겹쳐 응답이 유실·덮어쓰기되던 경합 제거
 *   · 학번 변경 시 상담 기록(ready_outreach)도 새 학번 키로 함께 이동 — 상담 이력 고아화 방지
 *     (상담 기록 이동은 상담사 계열 권한 필요 — 담당자 계정이면 응답만 이동하고 안내) */
export async function updateStudentProfile(
  rec: StudentRecord,
  patch: { student_id: string; name: string; dept: string; grade: string; phone: string }
): Promise<{ ok: boolean; message: string }> {
  if (!CLOUD_ENABLED) return { ok: false, message: "미리보기 모드에서는 저장되지 않습니다." };
  try {
    await authReady();
    const auth = getAuthInst();
    if (!auth.currentUser) return { ok: false, message: "로그인 상태를 확인해 주세요." };
    const db = getDb();
    const sem = rec.semester || SEMESTER;
    const oldId = `${sem}_${rec.student_id}`;
    const newStudentId = patch.student_id.trim();
    const newId = `${sem}_${newStudentId}`;

    const buildUpdated = (data: ResponsePayload & Record<string, unknown>) => ({
      ...data,
      profile: {
        ...data.profile,
        student_id: newStudentId,
        name: patch.name.trim(),
        dept: patch.dept.trim(),
        grade: patch.grade,
        phone: patch.phone.trim(),
      },
      semester: (data as { semester?: string }).semester ?? sem, // 구버전 문서의 결측 보정 (Rules 검증 대상)
      auth_uid: auth.currentUser!.uid, // Rules validResponse — 마지막 수정자 uid로 갱신
      profile_edited_by: auth.currentUser!.uid,
      profile_edited_at: new Date().toISOString(),
      // saved_at(검사 실시일)은 유지 — 교정이 실시일을 바꾸면 안 됨
    });

    if (newId !== oldId) {
      // 응답 문서 키 이동 — 트랜잭션으로 읽기·중복검사·복사·삭제를 원자화
      const conflict = await runTransaction(db, async (tx) => {
        const oldRef = doc(db, COL.responses, oldId);
        const newRef = doc(db, COL.responses, newId);
        const [oldSnap, dupSnap] = [await tx.get(oldRef), await tx.get(newRef)];
        if (!oldSnap.exists()) return "NO_SOURCE";
        if (dupSnap.exists()) return "DUP";
        tx.set(newRef, buildUpdated(oldSnap.data() as ResponsePayload & Record<string, unknown>));
        tx.delete(oldRef);
        return "OK";
      });
      if (conflict === "NO_SOURCE") return { ok: false, message: "원본 응답 문서를 찾을 수 없습니다." };
      if (conflict === "DUP")
        return { ok: false, message: `학번 ${newStudentId}의 응답이 이미 있습니다 — 학번을 확인해 주세요.` };

      // 상담 기록(ready_outreach) 키 이동 — 담당자(행정) 계정은 권한이 없어 실패할 수 있음 → 안내
      let outreachMoved = true;
      try {
        await runTransaction(db, async (tx) => {
          const oldRef = doc(db, COL.outreach, rec.student_id);
          const newRef = doc(db, COL.outreach, newStudentId);
          const [oldSnap, dupSnap] = [await tx.get(oldRef), await tx.get(newRef)];
          if (!oldSnap.exists()) return;
          if (!dupSnap.exists()) tx.set(newRef, oldSnap.data());
          tx.delete(oldRef);
        });
      } catch {
        outreachMoved = false;
      }
      moveOutreachLocal(rec.student_id, newStudentId); // 로컬 캐시도 함께 이동
      invalidateStudentsCache();
      return {
        ok: true,
        message: outreachMoved
          ? "학생 정보가 수정되었습니다 (상담 기록도 새 학번으로 이동)."
          : "학생 정보가 수정되었습니다. 상담 기록 이동 권한이 없어(상담사 계열 전용) 상담 기록은 워크스페이스에서 확인이 필요합니다.",
      };
    }

    // 학번 무변경 — 같은 문서 profile만 갱신 (트랜잭션으로 최신본 기준 수정)
    const done = await runTransaction(db, async (tx) => {
      const ref = doc(db, COL.responses, oldId);
      const snap = await tx.get(ref);
      if (!snap.exists()) return false;
      tx.set(ref, buildUpdated(snap.data() as ResponsePayload & Record<string, unknown>));
      return true;
    });
    if (!done) return { ok: false, message: "원본 응답 문서를 찾을 수 없습니다." };
    invalidateStudentsCache();
    return { ok: true, message: "학생 정보가 수정되었습니다." };
  } catch {
    return { ok: false, message: "저장에 실패했습니다. 네트워크·권한 상태를 확인해 주세요." };
  }
}

/** 화면용 훅 — 클라우드 설정 시 조회가 끝날 때까지 "불러오는 중"(빈 목록)으로 표시하고
 *  결과(실측 0건 포함 / 오류)로 교체한다. 캐시 무효화(로그인/로그아웃/새로고침 버튼) 시 자동 재조회.
 *  캐시가 이미 채워진 상태(화면 간 이동)에서는 then이 즉시 이행돼 깜빡임이 없다. */
export function useStudents(): StudentsData {
  const [data, setData] = useState<StudentsData>(() => lastKnown ?? (CLOUD_ENABLED ? LOADING : MOCK));
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (CLOUD_ENABLED && !cache) setData(LOADING); // 재조회 시작 — mock 깜빡임 방지
      void fetchStudentsCached().then((d) => alive && setData(d));
    };
    load();
    listeners.add(load);
    return () => {
      alive = false;
      listeners.delete(load);
    };
  }, []);
  return data;
}
