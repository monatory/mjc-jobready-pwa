/**
 * Firebase 연결 — 별도 신규 프로젝트 (2026-08-30 사용자 결정)
 * ───────────────────────────────────────────────────────────
 * 기존 MJC-CAT(mjc-career-pwa)과 같은 Firebase "계정"을 쓰되, "프로젝트"는 분리한다.
 *  - MJC-CAT Rules는 학번·이름을 차단하는 익명 설계 ↔ MJC-READY는 실명 필수 → 룰 상충
 *  - 프로젝트 분리로 기존 시스템 무접촉·쿼터 분리·개인정보 거버넌스 분리 (CLAUDE.md §7.3)
 *
 * ▶ 활성화 방법 (docs/FIREBASE_SETUP.md 참조):
 *   Firebase 콘솔에서 새 프로젝트(mjc-ready-pwa) 생성 → 웹 앱 등록 →
 *   발급된 firebaseConfig를 아래에 붙여넣으면 즉시 클라우드 모드로 전환된다.
 *   비어 있는 동안(CLOUD_ENABLED=false)에는 지금처럼 로컬(브라우저) 저장으로만 동작 — 아무것도 깨지지 않음.
 *
 * Web SDK의 apiKey는 프론트에 노출되는 것이 정상 — 보안은 Security Rules + Authorized Domains가 담당.
 */
import { initializeApp, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getAuth, type Auth } from "firebase/auth";

// ▼▼▼ 새 프로젝트 생성 후 콘솔의 firebaseConfig를 여기에 붙여넣기 ▼▼▼
const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};
// ▲▲▲──────────────────────────────────────────────────────▲▲▲

/** config가 채워졌는지 — false면 모든 클라우드 경로가 로컬 저장으로 폴백 */
export const CLOUD_ENABLED = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

/** 현재 학기 — 문서키 규칙 "{학기}_{학번}" (§7.1). 학기 전환 시 여기만 갱신 */
export const SEMESTER = "2026-2";

/** Firestore 컬렉션 이름 (전부 ready_ 접두 — 타 시스템과 이름공간 분리) */
export const COL = {
  responses: "ready_responses", // 학생 응답 원자료 + 판정 스냅샷 (실명)
  outreach: "ready_outreach",   // 상담사 학생 기록 (연락·회차·연계·취업)
  agencies: "ready_agencies",   // 연계기관·취업처 등록부
  staff: "ready_staff",         // 교직원 계정 메타 (역할·승인 상태) — Auth uid 키
} as const;

let _app: FirebaseApp | null = null;

export function getApp(): FirebaseApp {
  if (!_app) _app = initializeApp(firebaseConfig);
  return _app;
}

export function getDb(): Firestore {
  return getFirestore(getApp());
}

export function getAuthInst(): Auth {
  return getAuth(getApp());
}
