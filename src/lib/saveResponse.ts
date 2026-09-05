// 학생 응답 → Firestore 저장 (결과지 도달 시 + 실패 시 화면에서 재시도)
// 학생 전용 보조 Auth("student" 앱)의 익명 세션으로만 쓴다 (2026-08-31 수정):
//  · 관리자 로그인/로그아웃과 무관 — 같은 브라우저에서 스태프가 로그아웃해도 익명 uid 유지
//  · 스태프 계정 uid가 auth_uid에 저장되는 오염 방지
// CLOUD_ENABLED=false(설정 전)면 "OFF" 반환 — 프로토타입은 지금처럼 브라우저 저장만.
import { signInAnonymously } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { CLOUD_ENABLED, COL, SEMESTER, getStudentAuth, getStudentDb, authReadyFor } from "./firebase";
import { surveyItems, diagnosticBank, levelRules } from "./dataLoader";
import { getConsentInfo, type StudentProfile, type CertEntry, type ConsentInfo, type CounselRequest } from "./sessionState";

export interface ResponsePayload {
  profile: StudentProfile;
  survey: Record<string, string>;
  unscored: Record<string, string>;
  certs: CertEntry[];
  diag: Record<string, number>;
  result: { jas: number; jrs: number | null; cds: number | null; level: number; route_tag: string };
  /** 결과 시점에 노출된 추천활동 코드 스냅샷 (§7.1 studentRecommendations) — 활성기간이
   *  지나도 "그때 추천했던 활동"이 명단·CSV에서 사라지지 않도록 저장 (감사 P3-11) */
  recommendations?: string[];
  /** 개인정보 동의 시각·고지문 버전 — 명세 §7.2 "별도 Consent 값". 2026-09-03 이후 응답만 (점검 S2) */
  consent?: ConsentInfo;
  /** 결과지 "잡카페 상담 신청하기" 클릭 기록 — 설문 상담희망(배점 항목)과 별개의 이중장치.
   *  관리자·상담사 화면은 survey.counsel_wish==="YES" 또는 이 필드가 있으면 상담 희망으로 본다 (2026-09-05) */
  counsel_request?: CounselRequest;
}

/** DENIED = 서버 규칙 거부(permission-denied) — 재시도해도 같은 결과라 네트워크 안내와 구분한다 (점검 S3) */
export type SaveOutcome = "OK" | "FAIL" | "DENIED" | "OFF";

/** 오프라인·불안정 네트워크에서 setDoc이 무기한 대기하며 "제출 중…"에 고착되는 것 방지 (감사 S2-01) */
const SAVE_TIMEOUT_MS = 15000;
function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), SAVE_TIMEOUT_MS)),
  ]);
}

/** 문서키 "{학기}_{학번}" — 같은 학기 재응시는 최신값으로 갱신 (§7.1) */
export async function saveResponseToCloud(payload: ResponsePayload): Promise<SaveOutcome> {
  if (!CLOUD_ENABLED) return "OFF";
  try {
    const auth = getStudentAuth();
    await withTimeout(authReadyFor(auth)); // 새로고침 직후 익명 세션 복원 대기
    if (!auth.currentUser) await withTimeout(signInAnonymously(auth));
    // 문서키와 payload의 학번을 동일하게 trim — 서버 규칙(docId == semester_학번)과 일치 (감사 ENG-06)
    const studentId = payload.profile.student_id.trim();
    const cleanProfile: StudentProfile = {
      ...payload.profile,
      student_id: studentId,
      name: payload.profile.name.trim(),
      dept: payload.profile.dept.trim(),
      phone: payload.profile.phone.trim(),
    };
    const docId = `${SEMESTER}_${studentId}`;
    const consent = getConsentInfo(); // Firestore는 undefined 값을 거부하므로 있을 때만 필드 추가
    await withTimeout(
      setDoc(doc(getStudentDb(), COL.responses, docId), {
        ...payload,
        ...(consent ? { consent } : {}),
        profile: cleanProfile,
        semester: SEMESTER,
        auth_uid: auth.currentUser!.uid,
        saved_at: new Date().toISOString(),
        // 응시 시점의 문항·규칙 버전 기록 — 버전 개정 후에도 "그때 무엇으로 판정했는지" 추적 (감사 ENG-09)
        survey_version: (surveyItems as { version?: string }).version ?? "",
        diagnostic_version: (diagnosticBank as { version?: string }).version ?? "",
        rules_version: (levelRules as { version?: string }).version ?? "",
        schema_version: 2,
      })
    );
    return "OK";
  } catch (e) {
    // 규칙 거부는 재시도로 풀리지 않는다(학번 형식·문서키 불일치 등) — 네트워크와 다른 안내가 필요
    if ((e as { code?: string })?.code === "permission-denied") return "DENIED";
    return "FAIL"; // 오프라인·타임아웃 — 결과지가 실패 배너 + 재시도 버튼 표시 (조용한 유실 금지)
  }
}
