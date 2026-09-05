// 관리자·상담사 화면의 학생 데이터 소스 — 클라우드 모드는 실측(Firestore ready_responses)만 표시.
// 실측 문서의 "원응답"을 저장된 스냅샷이 아니라 판정 엔진으로 다시 계산해 표시한다(결정론 §3.1-②).
// (2026-09-01 감사 수정) 클라우드 모드에서 mock 폴백 금지 — 빈 DB는 "0건", 조회 실패는 "ERROR"로
// 구분 표시한다. 가짜 학생 40명이 실측처럼 떠서 실제 아웃리치 기록이 오염되던 경로(F07) 차단.
import { useEffect, useState } from "react";
import { collection, getDocs, doc, runTransaction, writeBatch } from "firebase/firestore";
import { CLOUD_ENABLED, COL, SEMESTER, getDb, getAuthInst, authReady } from "../lib/firebase";
import { evaluate, type EvaluationResult } from "../../lib/level_engine.js";
import { findWeakAreas } from "../../lib/weak_area.js";
import { resolveRecommendations, type RecommendationActivity } from "../../lib/recommendation_resolver.js";
import { surveyItems, diagnosticBank, levelRules } from "../lib/dataLoader";
// 시드+관리자 등록분 병합 (§4: 운영 중엔 Firestore가 진실)
import { getMasterSync, pullRecoMaster, findArchivedActivity } from "../lib/recoMaster";
import { localDateStr, todayStr } from "../lib/dates";
import { getMockStudents, type StudentRecord } from "./mockStudents";
import { moveOutreachLocal, removeOutreachLocal, type OutreachEntry } from "./outreach";
import type { ResponsePayload } from "../lib/saveResponse";

export type StudentsSource = "CLOUD" | "MOCK" | "LOADING" | "ERROR";
export interface StudentsData {
  students: StudentRecord[];
  source: StudentsSource;
  /** 스키마 불일치로 판정 불가해 제외된 실측 문서 수 — 배너에 표시(무음 스킵 금지, 감사 ENG-02) */
  skipped?: number;
}

const mockData = (): StudentsData => ({ students: getMockStudents(), source: "MOCK" });

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
    // 스냅샷은 "학생이 실제로 본 추천" — 그 사이 활동이 삭제·수정돼도 전건을 복원한다.
    // 현행 목록에 없으면 tombstone에 보존된 삭제 시점 정의(archived)로 되살린다
    // (부분 복원 시 관리자·CSV가 학생이 본 것보다 적게 보이던 문제 — 2026-09-02 점검 [중간-1])
    const found = codes
      .map((c) => {
        const current = master.activities.find((a) => a.recommendation_code === c);
        if (current) return current;
        // 현행 목록에 없는 활동(삭제·tombstone)은 이력 복원용 — 활성여부는 OFF로 표시한다.
        // archived 정의가 active:true를 품고 있어 05_추천활동 시트에 "ON"으로 나가던 문제 (점검 STU-08)
        const archived = findArchivedActivity(c) as unknown as RecommendationActivity | undefined;
        return archived ? { ...archived, active: false } : undefined;
      })
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
    // 콘솔 수기 문서의 학과·학년 결측은 빈 문자열로 — "정보 수정" 버튼이 startsWith에서 throw 하던 것 (점검 A15)
    dept: raw.profile.dept ?? "",
    grade: raw.profile.grade ?? "",
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
    consent_at: raw.consent?.at ?? "", // 동의 시각 — 구버전(2026-09-03 이전) 응답은 없음
    counsel_requested_at: raw.counsel_request?.at ?? "", // 결과지 상담 신청 버튼 (2026-09-05)
  };
}

/**
 * 학생 응답 삭제 — 마스터 전용 (2026-09-05 사용자 요구: 시범 운영 시작 전 테스트 응답 정리).
 * 응답 문서("{학기}_{학번}")와, 호출부가 지정한 상담 기록 문서(학번 키)를 배치로 지운다.
 * 상담 기록은 학번 단일 키라 다른 학기 응답이 남아 있으면 지우면 안 된다 — 어느 기록을 지울지는
 * 호출부(StudentsPanel)가 "그 학번의 응답이 전부 삭제 대상일 때"만 넘긴다.
 * 규칙: ready_responses delete = 승인 교직원, ready_outreach write = 상담사 계열(마스터 포함).
 * 화면은 마스터에게만 버튼을 보여 준다. 되돌릴 수 없으므로 호출부가 2중 확인을 받는다.
 */
export async function deleteStudentResponses(
  recs: StudentRecord[],
  outreachIds: string[]
): Promise<{ ok: boolean; deleted: number; message: string }> {
  if (!CLOUD_ENABLED) return { ok: false, deleted: 0, message: "미리보기 모드에서는 삭제되지 않습니다." };
  if (recs.length === 0) return { ok: false, deleted: 0, message: "삭제할 응답이 없습니다." };
  try {
    await authReady();
    const db = getDb();
    const targets = [
      ...recs.map((r) => doc(db, COL.responses, `${r.semester || SEMESTER}_${r.student_id}`)),
      ...outreachIds.map((id) => doc(db, COL.outreach, id)),
    ];
    // Firestore 배치 상한(500) 아래로 나눠 커밋 — 한 묶음이 실패하면 그 묶음은 통째로 남는다(원자성)
    const CHUNK = 200;
    let done = 0;
    for (let i = 0; i < targets.length; i += CHUNK) {
      const batch = writeBatch(db);
      targets.slice(i, i + CHUNK).forEach((ref) => batch.delete(ref));
      await batch.commit();
      done += Math.min(CHUNK, targets.length - i);
    }
    removeOutreachLocal(outreachIds);
    invalidateStudentsCache();
    void done;
    return { ok: true, deleted: recs.length, message: `응답 ${recs.length}건을 삭제했습니다.` };
  } catch (e) {
    const code = (e as { code?: string })?.code ?? "";
    invalidateStudentsCache(); // 일부 묶음만 지워졌을 수 있으므로 목록을 다시 받는다
    return {
      ok: false,
      deleted: 0,
      message:
        code === "permission-denied"
          ? "삭제 권한이 없습니다 — 마스터 계정으로 로그인했는지, 규칙이 게시됐는지 확인해 주세요."
          : "삭제 중 오류가 났습니다. 네트워크 상태를 확인하고 목록을 새로고침한 뒤 다시 시도해 주세요.",
    };
  }
}

let cache: Promise<StudentsData> | null = null;
let lastKnown: StudentsData | null = null; // 조회 완료 결과 — 화면 전환 시 동기 재사용(깜빡임 없음)

async function fetchStudents(): Promise<StudentsData> {
  if (!CLOUD_ENABLED) return mockData(); // 미리보기(mock)는 클라우드 설정 전에만
  try {
    await authReady(); // 새로고침 시 로그인 복원 대기 — 복원 전 조회는 권한 거부됨
    // 추천활동 Master를 먼저 받아야 학생별 추천이 최신 목록으로 계산된다. 이걸 빼면 관리자가
    // 활동을 등록·수정해도 명단·상세·CSV가 시드 기준으로 남는다 (2026-09-02 점검 [높음-1]).
    // 실패해도 학생 조회는 진행 — 추천만 시드·캐시 기준이 된다.
    await pullRecoMaster();
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
  patch: { student_id: string; name: string; dept: string; grade: string; phone: string },
  opts: { canMoveId: boolean } = { canMoveId: true }
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
    // (2026-09-03 점검 A1) 상담 기록(ready_outreach)은 상담사 계열만 쓸 수 있다. 담당자(행정)가
    // 학번을 바꾸면 응답만 옮겨지고 상담 기록은 옛 학번 밑에 고아로 남아 "항상 실패" 경고가 났다.
    // 화면(StudentsPanel)이 1차로 막고, 여기서도 한 번 더 거른다.
    if (newId !== oldId && !opts.canMoveId)
      return { ok: false, message: "학번 변경은 상담사 계정에서만 할 수 있습니다 — 상담 기록이 함께 이동해야 합니다." };

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

      // 상담 기록(ready_outreach) 키 이동 — 위 가드로 상담사 계열만 여기 도달하므로 실패는 네트워크·
      // 규칙 미게시 등 예외 상황뿐 → 안내. 대상 학번에 기록이 이미 있으면 **병합**한다. 예전에는 복사 없이 원본을 지워서
      // 옛 학번의 상담 이력(회차·연계·취업)이 통째로 사라졌다 (2026-09-02 점검 CNS-03/CON-05).
      let outreachResult: "MOVED" | "MERGED" | "NONE" | "FAIL" = "NONE";
      try {
        outreachResult = await runTransaction(db, async (tx) => {
          const oldRef = doc(db, COL.outreach, rec.student_id);
          const newRef = doc(db, COL.outreach, newStudentId);
          const [oldSnap, dupSnap] = [await tx.get(oldRef), await tx.get(newRef)];
          if (!oldSnap.exists()) return "NONE" as const;
          const src = oldSnap.data() as OutreachEntry;
          if (!dupSnap.exists()) {
            tx.set(newRef, src);
            tx.delete(oldRef);
            return "MOVED" as const;
          }
          // 병합: 회차는 양쪽을 합쳐 날짜순 재번호, 나머지는 대상(새 학번) 값을 우선하되 빈 값만 채운다
          const dst = dupSnap.data() as OutreachEntry;
          const sessions = [...(src.sessions ?? []), ...(dst.sessions ?? [])]
            .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
            .map((s, i) => ({ ...s, seq: i + 1 }));
          const merged: OutreachEntry = {
            ...src,
            ...dst,
            sessions,
            memo: dst.memo || src.memo,
            final_summary: dst.final_summary || src.final_summary,
            referral: dst.referral ?? src.referral,
            employment: dst.employment ?? src.employment,
            updated_at: new Date().toISOString(),
          };
          tx.set(newRef, merged);
          tx.delete(oldRef);
          return "MERGED" as const;
        });
      } catch {
        outreachResult = "FAIL";
      }
      if (outreachResult !== "FAIL") moveOutreachLocal(rec.student_id, newStudentId); // 로컬 캐시도 함께 이동
      invalidateStudentsCache();
      const outreachMsg = {
        MOVED: " (상담 기록도 새 학번으로 이동)",
        MERGED: " ⚠ 새 학번에 이미 상담 기록이 있어 **두 기록을 병합**했습니다 — 워크스페이스에서 회차·연계 내용을 확인해 주세요.",
        NONE: "",
        FAIL: " ⚠ 상담 기록은 옮기지 못했습니다(네트워크 오류 또는 권한 문제). 기록은 옛 학번에 그대로 남아 있으니 잠시 후 이 학생을 다시 열어 학번을 확인해 주세요.",
      }[outreachResult];
      return { ok: true, message: `학생 정보가 수정되었습니다.${outreachMsg}` };
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
/** @param enabled 로그인 게이트를 통과한 뒤에만 조회한다. 미인증 상태에서 실명 응답을 미리
 *  받아오지 않도록 하는 안전장치 (서버 규칙이 1차 방어, 이건 2차 — 2026-09-02 점검 SEC-02). */
export function useStudents(enabled = true): StudentsData {
  const [data, setData] = useState<StudentsData>(() => lastKnown ?? (CLOUD_ENABLED ? LOADING : mockData()));
  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled]);
  return data;
}
