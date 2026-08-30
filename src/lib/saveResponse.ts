// 학생 응답 → Firestore 저장 (결과지 도달 시 1회)
// 익명 인증으로 쓰기 — Security Rules가 본인 문서(auth_uid)만 갱신 허용.
// CLOUD_ENABLED=false(설정 전)면 false 반환 — 프로토타입은 지금처럼 브라우저 저장만.
import { signInAnonymously } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { CLOUD_ENABLED, COL, SEMESTER, getAuthInst, getDb } from "./firebase";
import type { StudentProfile, CertEntry } from "./sessionState";

export interface ResponsePayload {
  profile: StudentProfile;
  survey: Record<string, string>;
  unscored: Record<string, string>;
  certs: CertEntry[];
  diag: Record<string, number>;
  result: { jas: number; jrs: number | null; cds: number | null; level: number; route_tag: string };
}

/** 문서키 "{학기}_{학번}" — 같은 학기 재응시는 최신값으로 갱신 (§7.1) */
export async function saveResponseToCloud(payload: ResponsePayload): Promise<boolean> {
  if (!CLOUD_ENABLED) return false;
  try {
    const auth = getAuthInst();
    if (!auth.currentUser) await signInAnonymously(auth);
    const docId = `${SEMESTER}_${payload.profile.student_id.trim()}`;
    await setDoc(doc(getDb(), COL.responses, docId), {
      ...payload,
      semester: SEMESTER,
      auth_uid: auth.currentUser!.uid,
      saved_at: new Date().toISOString(),
      schema_version: 1,
    });
    return true;
  } catch {
    return false; // Rules 미배포·오프라인 — 조용히 실패 (로컬 흐름은 계속)
  }
}
