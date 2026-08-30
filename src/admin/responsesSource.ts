// 관리자·상담사 화면의 학생 데이터 소스 — 실측(Firestore ready_responses) 우선, 없으면 mock 미리보기.
// 실측 문서의 "원응답"을 저장된 스냅샷이 아니라 판정 엔진으로 다시 계산해 표시한다(결정론 §3.1-②).
import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { CLOUD_ENABLED, COL, getDb, authReady } from "../lib/firebase";
import { evaluate, type EvaluationResult } from "../../lib/level_engine.js";
import { findWeakAreas } from "../../lib/weak_area.js";
import { resolveRecommendations } from "../../lib/recommendation_resolver.js";
import { surveyItems, diagnosticBank, levelRules, recommendationMaster } from "../lib/dataLoader";
import { mockStudents, type StudentRecord } from "./mockStudents";
import type { ResponsePayload } from "../lib/saveResponse";

export type StudentsSource = "CLOUD" | "MOCK";
export interface StudentsData {
  students: StudentRecord[];
  source: StudentsSource;
}

const MOCK: StudentsData = { students: mockStudents, source: "MOCK" };

function toStudentRecord(raw: ResponsePayload & { saved_at?: string }): StudentRecord {
  const result = evaluate(raw.survey, raw.diag, { surveyItems, diagnosticBank, levelRules }) as EvaluationResult;
  const weak = findWeakAreas(
    result.domainScores,
    diagnosticBank,
    (levelRules as unknown as { weak_area: { threshold: number; max_count: number } }).weak_area
  );
  const recs = resolveRecommendations(result.level, weak, recommendationMaster, {
    today: new Date().toISOString().slice(0, 10),
  });
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

async function fetchStudents(): Promise<StudentsData> {
  if (!CLOUD_ENABLED) return MOCK;
  try {
    await authReady(); // 새로고침 시 로그인 복원 대기 — 복원 전 조회는 권한 거부됨
    const snap = await getDocs(collection(getDb(), COL.responses));
    if (snap.empty) return MOCK;
    const students: StudentRecord[] = [];
    snap.forEach((d) => {
      try {
        students.push(toStudentRecord(d.data() as ResponsePayload));
      } catch {
        /* 스키마 불일치 문서는 건너뜀 */
      }
    });
    return students.length > 0 ? { students, source: "CLOUD" } : MOCK;
  } catch {
    return MOCK; // 미로그인·Rules 미배포 — 미리보기 유지
  }
}

/** 세션당 1회 조회 캐시 — 로그인·로그아웃 시 무효화(권한이 바뀌므로 재조회 필요) */
export function fetchStudentsCached(): Promise<StudentsData> {
  return (cache ??= fetchStudents());
}

const listeners = new Set<() => void>();
export function invalidateStudentsCache(): void {
  cache = null;
  listeners.forEach((l) => l());
}

/** 화면용 훅 — mock으로 즉시 그리고, 실측이 오면 교체. 캐시 무효화 시 자동 재조회 */
export function useStudents(): StudentsData {
  const [data, setData] = useState<StudentsData>(MOCK);
  useEffect(() => {
    let alive = true;
    const load = () => void fetchStudentsCached().then((d) => alive && setData(d));
    load();
    listeners.add(load);
    return () => {
      alive = false;
      listeners.delete(load);
    };
  }, []);
  return data;
}
