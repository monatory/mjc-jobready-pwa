// 학생 응답 → Firestore 저장 (결과지 도달 시 + 실패 시 화면에서 재시도)
// 학생 전용 보조 Auth("student" 앱)의 익명 세션으로만 쓴다 (2026-08-31 수정):
//  · 관리자 로그인/로그아웃과 무관 — 같은 브라우저에서 스태프가 로그아웃해도 익명 uid 유지
//  · 스태프 계정 uid가 auth_uid에 저장되는 오염 방지
// CLOUD_ENABLED=false(설정 전)면 "OFF" 반환 — 프로토타입은 지금처럼 브라우저 저장만.
import { signInAnonymously } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { CLOUD_ENABLED, COL, SEMESTER, getStudentAuth, getStudentDb, authReadyFor } from "./firebase";
import type { StudentProfile, CertEntry } from "./sessionState";

export interface ResponsePayload {
  profile: StudentProfile;
  survey: Record<string, string>;
  unscored: Record<string, string>;
  certs: CertEntry[];
  diag: Record<string, number>;
  result: { jas: number; jrs: number | null; cds: number | null; level: number; route_tag: string };
}

export type SaveOutcome = "OK" | "FAIL" | "OFF";

/** 문서키 "{학기}_{학번}" — 같은 학기 재응시는 최신값으로 갱신 (§7.1) */
export async function saveResponseToCloud(payload: ResponsePayload): Promise<SaveOutcome> {
  if (!CLOUD_ENABLED) return "OFF";
  try {
    const auth = getStudentAuth();
    await authReadyFor(auth); // 새로고침 직후 익명 세션 복원 대기
    if (!auth.currentUser) await signInAnonymously(auth);
    const docId = `${SEMESTER}_${payload.profile.student_id.trim()}`;
    await setDoc(doc(getStudentDb(), COL.responses, docId), {
      ...payload,
      semester: SEMESTER,
      auth_uid: auth.currentUser!.uid,
      saved_at: new Date().toISOString(),
      schema_version: 1,
    });
    return "OK";
  } catch {
    return "FAIL"; // 오프라인·규칙 거부 — 결과지가 실패 배너 + 재시도 버튼 표시 (조용한 유실 금지)
  }
}
