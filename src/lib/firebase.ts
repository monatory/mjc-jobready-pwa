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
import { initializeFirestore, type Firestore } from "firebase/firestore";
import { getAuth, onAuthStateChanged, type Auth } from "firebase/auth";

// ▼▼▼ mjc-ready-pwa 프로젝트 설정 (2026-08-30 사용자 제공) ▼▼▼
const firebaseConfig = {
  apiKey: "AIzaSyC2hu-6elRqISSZB9bwgwksBma0Dt1ZFTo",
  authDomain: "mjc-ready-pwa.firebaseapp.com",
  projectId: "mjc-ready-pwa",
  storageBucket: "mjc-ready-pwa.firebasestorage.app",
  messagingSenderId: "65253686172",
  appId: "1:65253686172:web:fac7d75510f94f3f006659",
};
// ▲▲▲──────────────────────────────────────────────────────▲▲▲

/** config가 채워졌는지 — false면 모든 클라우드 경로가 로컬 저장으로 폴백 */
export const CLOUD_ENABLED = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

/** 현재 학기 자동 산출 — 문서키 규칙 "{학기}_{학번}" (§7.1).
 *  3~8월 = "{연도}-1", 9~12월 = "{연도}-2", 1~2월 = "{전년도}-2"(2학기는 이듬해 2월까지).
 *  하드코딩 상수였을 때 학기 전환기에 갱신·재배포를 놓치면 새 학기 응시가 이전 학기 문서를
 *  덮어써 학기별 누적(명세 핵심)이 깨지는 문제(감사 P5-04)의 수정 — 날짜 기반 결정론 산출. */
function computeSemester(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  if (m >= 3 && m <= 8) return `${y}-1`;
  if (m >= 9) return `${y}-2`;
  return `${y - 1}-2`;
}
export const SEMESTER = computeSemester(new Date());

/** Firestore 컬렉션 이름 (전부 ready_ 접두 — 타 시스템과 이름공간 분리) */
export const COL = {
  responses: "ready_responses", // 학생 응답 원자료 + 판정 스냅샷 (실명)
  outreach: "ready_outreach",   // 상담사 학생 기록 (연락·회차·연계·취업)
  agencies: "ready_agencies",   // 연계기관·취업처 등록부
  staff: "ready_staff",         // 교직원 계정 메타 (역할·승인 상태) — Auth uid 키
  recoMaster: "ready_reco_master", // 추천활동 Master 오버라이드 (시드 JSON 위에 병합 — src/lib/recoMaster.ts)
} as const;

let _app: FirebaseApp | null = null;
let _db: Firestore | null = null;

export function getApp(): FirebaseApp {
  if (!_app) _app = initializeApp(firebaseConfig);
  return _app;
}

export function getDb(): Firestore {
  // ignoreUndefinedProperties: 선택 필드(연계일·메모 등)가 비어 undefined로 남아도
  // 쓰기가 조용히 실패하지 않도록 — 2026-08-30 라이브 테스트에서 발견된 유실 원인 수정
  if (!_db) _db = initializeFirestore(getApp(), { ignoreUndefinedProperties: true });
  return _db;
}

export function getAuthInst(): Auth {
  return getAuth(getApp());
}

// ── 보조 앱 인스턴스 (2026-08-31) ──
// 같은 브라우저에서 관리자 로그인/로그아웃과 학생 익명 제출·계정 가입 처리가 서로의
// 인증 세션을 파괴하던 문제의 근본 수정 — 용도별로 Auth 세션을 물리적으로 분리한다.
//  · "student": 학생 응답 제출 전용 익명 세션. 관리자 로그아웃(fbSignOut)의 영향을 받지 않아
//    같은 브라우저 재응시 시 익명 uid가 유지된다.
//  · "signup": 교직원 가입 신청 전용. createUserWithEmailAndPassword가 현재 로그인
//    세션(마스터 등)을 갈아타지 않도록 격리한다.

function secondaryApp(name: string): FirebaseApp {
  return initializeApp(firebaseConfig, name);
}

let _studentApp: FirebaseApp | null = null;
let _studentDb: Firestore | null = null;

export function getStudentAuth(): Auth {
  if (!_studentApp) _studentApp = secondaryApp("student");
  return getAuth(_studentApp);
}

export function getStudentDb(): Firestore {
  if (!_studentApp) _studentApp = secondaryApp("student");
  if (!_studentDb) _studentDb = initializeFirestore(_studentApp, { ignoreUndefinedProperties: true });
  return _studentDb;
}

let _signupApp: FirebaseApp | null = null;
let _signupDb: Firestore | null = null;

export function getSignupAuth(): Auth {
  if (!_signupApp) _signupApp = secondaryApp("signup");
  return getAuth(_signupApp);
}

export function getSignupDb(): Firestore {
  if (!_signupApp) _signupApp = secondaryApp("signup");
  if (!_signupDb) _signupDb = initializeFirestore(_signupApp, { ignoreUndefinedProperties: true });
  return _signupDb;
}

/** 임의 Auth 인스턴스의 로그인 상태 복원 대기 (authReady의 인스턴스 지정판) */
export function authReadyFor(auth: Auth): Promise<void> {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, () => {
      unsub();
      resolve();
    });
  });
}

/**
 * 새로고침 직후 Firebase가 로그인 상태를 복원할 때까지 대기.
 * 인증이 필요한 첫 조회(fetch) 전에 반드시 호출 — 복원 전에 조회하면 권한 거부로 폴백돼 버림.
 */
export function authReady(): Promise<void> {
  if (!CLOUD_ENABLED) return Promise.resolve();
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(getAuthInst(), () => {
      unsub();
      resolve();
    });
  });
}
