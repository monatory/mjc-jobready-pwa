// 관리자 계정·인증 모듈 — 하이브리드 (2026-08-30 Firebase 프로젝트 분리 결정)
//  · CLOUD_ENABLED(firebase.ts 설정 완료) + 이메일 아이디 → Firebase Auth + ready_staff 문서
//  · 그 외(설정 전·이메일 아닌 아이디) → 기존 로컬(localStorage) 인증으로 폴백
// 마스터는 Firebase 콘솔에서 직접 생성한 계정(이메일 = MASTER_ID)으로 로그인하며,
// 역할은 이메일 일치로 판정한다(Security Rules에서도 동일하게 강제).
// 로컬 모드 비밀번호는 SHA-256 해시만 보관 — 클라우드 전환 시 자연 대체.
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut as fbSignOut,
  onAuthStateChanged,
} from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, getDocs, collection } from "firebase/firestore";
import { CLOUD_ENABLED, COL, getAuthInst, getDb, getSignupAuth, getSignupDb, authReady, authReadyFor } from "../lib/firebase";

// 역할 체계 (2026-08-30 사용자 확정 — "담당자는 상담사 페이지를 볼 수 없어야 한다"):
//  MASTER          마스터(개발자=사용자) — 양쪽 전부
//  ADMIN_LEAD      담당자 관리자 — 담당자(행정) 권한 + 담당자 계정 승인·관리 (2026-09-03 추가,
//                  상담사 관리자와 대칭. 마스터가 임명하며 상담사 워크스페이스는 여전히 접근 불가)
//  ADMIN           담당자(행정) — 일반 관리 화면 + 엑셀 다운로드만. 상담사 워크스페이스 접근 불가
//  COUNSELOR_LEAD  상담사 관리자 — 상담사 워크스페이스 + 상담사 계정 등록·관리
//  COUNSELOR       상담사 — 상담사 워크스페이스(연락 관리 공유)
export type AdminRole = "MASTER" | "ADMIN_LEAD" | "ADMIN" | "COUNSELOR_LEAD" | "COUNSELOR";
// DELETED: 클라우드 계정 삭제 tombstone — 문서를 지우면 Auth 사용자가 남아 재로그인 시
// "고아 복구" 경로로 승인 대기에 계속 부활했다(감사 P3-12·C4-10). 삭제 표식을 남겨 차단한다.
export type AccountStatus = "ACTIVE" | "PENDING" | "DISABLED" | "DELETED";

export interface AdminAccount {
  id: string;          // 로그인 아이디 (클라우드 계정은 이메일)
  name: string;        // 표시 이름
  dept: string;        // 소속 (선택)
  role: AdminRole;
  status: AccountStatus;
  pw_hash: string;     // SHA-256 hex (클라우드 계정은 빈 문자열 — 비밀번호는 Firebase가 관리)
  created_at: string;
  approved_at?: string;
  uid?: string;        // Firebase Auth uid (클라우드 계정 전용)
}

export interface AdminSession {
  id: string;
  name: string;
  role: AdminRole;
  login_at: string;
}

export const ROLE_LABELS: Record<AdminRole, string> = {
  MASTER: "마스터 관리자",
  ADMIN_LEAD: "담당자 관리자",
  ADMIN: "담당자(행정)",
  COUNSELOR_LEAD: "상담사 관리자",
  COUNSELOR: "상담사",
};

/** 관리자(LEAD) ↔ 일반 짝 — 임명·해제에 쓰는 반대편 역할. 그 외 역할은 null(전환 대상 아님) */
export const leadCounterpart = (role: AdminRole): AdminRole | null =>
  role === "ADMIN" ? "ADMIN_LEAD"
    : role === "ADMIN_LEAD" ? "ADMIN"
      : role === "COUNSELOR" ? "COUNSELOR_LEAD"
        : role === "COUNSELOR_LEAD" ? "COUNSELOR"
          : null;

/** 상담사 워크스페이스(#/counsel) 접근 가능 역할 — 담당자(행정)는 절대 불가 */
export const isCounselSide = (role: AdminRole): boolean =>
  role === "MASTER" || role === "COUNSELOR_LEAD" || role === "COUNSELOR";

/** 로그인 후 기본 진입 경로 — 상담사 계열은 전용 워크스페이스로 */
export const homeRoute = (role: AdminRole): string =>
  role === "COUNSELOR" || role === "COUNSELOR_LEAD" ? "/counsel" : "/admin";

export const STATUS_LABELS: Record<AccountStatus, string> = {
  ACTIVE: "사용 중",
  PENDING: "승인 대기",
  DISABLED: "비활성",
  DELETED: "삭제됨",
};

// ── 권한 매트릭스 — 섹션 키 → 접근 가능한 역할 ──
// 관리자 화면(#/admin)은 담당자(행정)·마스터 전용. 상담사 계열은 #/counsel만.
export const SECTION_ROLES: Record<string, AdminRole[]> = {
  overview: ["MASTER", "ADMIN_LEAD", "ADMIN"],
  students: ["MASTER", "ADMIN_LEAD", "ADMIN"],
  recommend: ["MASTER", "ADMIN_LEAD", "ADMIN"],
  download: ["MASTER", "ADMIN_LEAD", "ADMIN"],
  // 담당자 계정 관리 — 마스터가 임명한 담당자 관리자도 승인·관리 가능 (2026-09-03,
  // 상담사 관리자(counselAccounts)와 대칭. 계정 직접 등록은 Rules상 마스터 전용 유지)
  accounts: ["MASTER", "ADMIN_LEAD"],
  // 상담사 워크스페이스(#/counsel) 섹션
  counselStudents: ["MASTER", "COUNSELOR_LEAD", "COUNSELOR"],
  counselAgencies: ["MASTER", "COUNSELOR_LEAD", "COUNSELOR"], // 연계기관·취업처 등록부 (공유 자원)
  counselAccounts: ["MASTER", "COUNSELOR_LEAD"],
};
export const canAccess = (role: AdminRole, section: string): boolean =>
  (SECTION_ROLES[section] ?? []).includes(role);

const ACCOUNTS_KEY = "mjc_ready_admin_accounts";
const SESSION_KEY = "mjc_ready_admin_session";
// 신청 시 고른 구분(역할) 기억 — 신청 문서 쓰기가 실패해 Auth 사용자만 남은 경우,
// 다음 로그인의 고아 복구가 역할을 상담사로 잘못 접수하던 문제를 막는다 (2026-09-03).
const REQ_ROLE_KEY = "mjc_ready_signup_roles";

function rememberRequestedRole(email: string, role: AdminRole): void {
  try {
    const map = JSON.parse(localStorage.getItem(REQ_ROLE_KEY) ?? "{}") as Record<string, AdminRole>;
    map[email] = role;
    localStorage.setItem(REQ_ROLE_KEY, JSON.stringify(map));
  } catch {
    /* 저장 실패는 무시 — 복구 시 기본값(상담사)으로 접수되고, 마스터가 구분을 바꿀 수 있다 */
  }
}

function recallRequestedRole(email: string): AdminRole | null {
  try {
    const map = JSON.parse(localStorage.getItem(REQ_ROLE_KEY) ?? "{}") as Record<string, AdminRole>;
    return map[email] ?? null;
  } catch {
    return null;
  }
}

// 마스터 내장 계정 (개발자 본인) — 등록 절차 없이 최초부터 로그인 가능.
// 비밀번호는 원문을 코드에 두지 않고 SHA-256 해시로만 고정(2026-08-30 사용자 지정).
// ⚠ 공개 저장소·배포 번들에 해시가 노출되므로, 이 비밀번호는 다른 서비스와 절대 공유 금지.
// 계정은 어떤 계정 목록에도 표시되지 않으며(§6.4) 삭제·비활성·해시 변경이 불가능하다.
export const MASTER_ID = "monatory82@gmail.com";
const MASTER_PW_HASH = "c2b8692c7e461e2c080649c5c17e3778f385012e41f13a4db51eb56687ed31b0";

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function loadAccounts(): AdminAccount[] {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? "[]") as AdminAccount[];
  } catch {
    return [];
  }
}

function saveAccounts(accounts: AdminAccount[]): void {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

/** 마스터 내장 계정 보장 — 항상 고정 해시·활성 상태로 강제 (변조·구버전 잔재 정리 포함) */
export async function ensureMasterAccount(): Promise<void> {
  // MASTER 역할은 지정된 1개 계정만 존재 — 구버전("master")·변조된 MASTER 계정은 제거
  const accounts = loadAccounts().filter((a) => a.role !== "MASTER" && a.id !== MASTER_ID);
  accounts.unshift({
    id: MASTER_ID,
    name: "마스터 관리자",
    dept: "학생지원처 취·창업팀",
    role: "MASTER",
    status: "ACTIVE",
    pw_hash: MASTER_PW_HASH, // 코드 고정 — changePassword로도 변경 불가
    created_at: new Date().toISOString(),
    approved_at: new Date().toISOString(),
  });
  saveAccounts(accounts);
}

/** 가입 신청 (담당자·상담사) — 승인 대기 상태로 등록. 클라우드 설정 후에는 이메일 아이디 권장 */
export async function registerAccount(input: {
  id: string;
  name: string;
  dept: string;
  role: Exclude<AdminRole, "MASTER" | "COUNSELOR_LEAD">;
  password: string;
}): Promise<{ ok: boolean; message: string }> {
  // 대소문자만 다른 유사 계정 방지 — 아이디는 소문자로 정규화
  const id = input.id.trim().toLowerCase();
  if (!input.name.trim()) return { ok: false, message: "이름을 입력해 주세요." };
  if (input.password.length < 8) return { ok: false, message: "비밀번호는 8자 이상으로 입력해 주세요." };
  if (id === MASTER_ID) return { ok: false, message: "사용할 수 없는 아이디입니다." };

  // ── 클라우드 경로: 이메일 아이디 + Firebase 설정 완료 ──
  // 보조 "signup" 인스턴스 사용 (2026-08-31): createUserWithEmailAndPassword가 현재 브라우저의
  // 로그인 세션(마스터·상담사·학생 익명)을 갈아타 파괴하던 문제 수정 — 신청은 격리된 세션에서 처리.
  if (CLOUD_ENABLED && id.includes("@")) {
    const auth = getSignupAuth();
    // 신청한 구분을 먼저 기억 — 아래 문서 쓰기가 실패해도 고아 복구가 역할을 되살릴 수 있게 (2026-09-03)
    rememberRequestedRole(id, input.role);
    try {
      const cred = await createUserWithEmailAndPassword(auth, id, input.password);
      // (2026-09-03) Firestore가 새 사용자의 인증 토큰을 반영할 때까지 대기. 대기 없이 쓰면
      // 비인증 요청으로 나가 규칙에 거부되고 Auth 사용자만 남는 "고아"가 된다 — 그 상태로
      // 로그인하면 복구 경로가 역할을 상담사로 접수해, 담당자 신청이 상담사 대기열에 떴다.
      await authReadyFor(auth);
      await setDoc(doc(getSignupDb(), COL.staff, cred.user.uid), {
        email: id,
        name: input.name.trim(),
        dept: input.dept.trim(),
        role: input.role,
        status: "PENDING",
        created_at: new Date().toISOString(),
      });
      await fbSignOut(auth).catch(() => {});
      return { ok: true, message: "신청이 접수되었습니다. 승인 후 로그인할 수 있습니다." };
    } catch (e) {
      await fbSignOut(auth).catch(() => {});
      const code = (e as { code?: string })?.code ?? "";
      if (code === "auth/email-already-in-use") return { ok: false, message: "이미 등록된 이메일입니다. 신청한 적이 있다면 로그인해 보세요 — 승인 대기 접수가 자동으로 복구됩니다." };
      if (code === "auth/invalid-email") return { ok: false, message: "이메일 형식을 확인해 주세요." };
      // (2026-09-01 감사 P3-08) 네트워크 장애 시 로컬 폴백 금지 — 이 브라우저에만 존재하는 계정이
      // 만들어져 마스터가 승인할 수 없고, 클라우드 복구 후에는 로그인도 안 되는 데드엔드였다.
      if (code === "auth/network-request-failed")
        return { ok: false, message: "네트워크 오류로 신청하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요." };
      if (!["auth/operation-not-allowed", "auth/configuration-not-found"].includes(code))
        return { ok: false, message: "신청 처리에 실패했습니다. 잠시 후 다시 시도해 주세요." };
      // 프로바이더 미설정(콘솔 설정 전)만 → 로컬 등록으로 폴백
    }
  }

  // ── 로컬 경로 ──
  // (2026-09-03) 클라우드 모드에서 비이메일 아이디는 이 브라우저 localStorage에만 계정이 생겨
  // 마스터 화면(공유 ready_staff 목록)에 영영 뜨지 않는 데드엔드였다 — 신청자는 승인을 기다리고
  // 마스터는 신청이 없다고 본다. 신청 자체를 막고 이메일을 요구한다. (프로바이더 미설정으로
  // 위 클라우드 경로가 폴백된 경우는 아이디에 @가 있으므로 이 가드에 걸리지 않는다.)
  if (CLOUD_ENABLED && !id.includes("@"))
    return {
      ok: false,
      message: "아이디는 이메일 주소로 입력해 주세요. 승인·로그인이 학교 공용 저장소로 처리되어, 이메일이 아니면 신청이 관리자에게 전달되지 않습니다.",
    };
  if (!/^[a-z0-9_.@-]{4,40}$/.test(id))
    return { ok: false, message: "아이디는 영문 소문자·숫자(또는 이메일) 4~40자로 입력해 주세요." };
  const accounts = loadAccounts();
  if (accounts.some((a) => a.id === id)) return { ok: false, message: "이미 사용 중인 아이디입니다." };
  accounts.push({
    id,
    name: input.name.trim(),
    dept: input.dept.trim(),
    role: input.role,
    status: "PENDING",
    pw_hash: await sha256(input.password),
    created_at: new Date().toISOString(),
  });
  saveAccounts(accounts);
  return { ok: true, message: "신청이 접수되었습니다. 승인 후 로그인할 수 있습니다." };
}

type LoginResult = { ok: boolean; message: string; session?: AdminSession };

/** 브라우저 저장소가 막힌 환경(사이트 데이터 차단 등) — 세션을 보관할 수 없어 로그인 상태가 유지되지 않는다 */
class StorageBlockedError extends Error {}

function storeSession(id: string, name: string, role: AdminRole): AdminSession {
  const session: AdminSession = { id, name, role, login_at: new Date().toISOString() };
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // 여기서 throw가 새어 나가면 로그인 버튼이 "처리 중"에 고착됐다 (점검 A7) — login()이 안내 문구로 바꾼다
    throw new StorageBlockedError("storage blocked");
  }
  // 로그인으로 읽기 권한이 생겼으므로 학생 데이터 캐시 재조회 (동적 import — 순환 방지)
  void import("./responsesSource").then((m) => m.invalidateStudentsCache());
  return session;
}

/** 로컬(localStorage) 로그인 — 클라우드 설정 전 또는 이메일 아닌 아이디 */
async function localLogin(id: string, password: string): Promise<LoginResult> {
  await ensureMasterAccount();
  const account = loadAccounts().find((a) => a.id === id.trim().toLowerCase());
  if (!account || account.pw_hash !== (await sha256(password)))
    return { ok: false, message: "아이디 또는 비밀번호가 올바르지 않습니다." };
  if (account.status === "PENDING") return { ok: false, message: "승인 대기 중인 계정입니다. 승인 후 로그인할 수 있습니다." };
  if (account.status === "DISABLED") return { ok: false, message: "비활성화된 계정입니다. 마스터 관리자에게 문의해 주세요." };
  return { ok: true, message: "", session: storeSession(account.id, account.name, account.role) };
}

/** 클라우드(Firebase Auth) 로그인 — null 반환 시 로컬 폴백 */
async function cloudLogin(email: string, password: string): Promise<LoginResult | null> {
  const auth = getAuthInst();
  let uid: string;
  try {
    uid = (await signInWithEmailAndPassword(auth, email, password)).user.uid;
  } catch (e) {
    const code = (e as { code?: string })?.code ?? "";
    // (2026-09-01 감사 F11) 네트워크 장애는 로컬 폴백 금지 — Firebase 미인증 상태로 워크스페이스에
    // 들어가 모든 공유(응답 조회·상담 기록)가 조용히 로컬 전용이 되던 경로 차단. 오류로 안내한다.
    if (code === "auth/network-request-failed")
      return { ok: false, message: "네트워크 오류로 로그인하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요." };
    // 프로바이더 미설정(콘솔 설정 전)만 → 로컬 인증으로 폴백
    if (["auth/operation-not-allowed", "auth/configuration-not-found"].includes(code)) return null;
    if (email === MASTER_ID && code === "auth/user-not-found")
      return { ok: false, message: "마스터 계정이 아직 없습니다 — Firebase 콘솔 Authentication에서 먼저 생성해 주세요 (SETUP 가이드 3단계)." };
    return { ok: false, message: "아이디 또는 비밀번호가 올바르지 않습니다." };
  }
  const db = getDb();
  if (email === MASTER_ID) {
    // 마스터 — 이메일 일치로 판정 (Rules에서도 동일), staff 문서는 참고용으로 보장
    setDoc(
      doc(db, COL.staff, uid),
      { email, name: "마스터 관리자", dept: "학생지원처 취·창업팀", role: "MASTER", status: "ACTIVE", created_at: new Date().toISOString() },
      { merge: true }
    ).catch(() => {});
    return { ok: true, message: "", session: storeSession(email, "마스터 관리자", "MASTER") };
  }
  const snap = await getDoc(doc(db, COL.staff, uid)).catch(() => null);
  if (!snap || !snap.exists()) {
    // 고아 계정 복구 (2026-08-31): 가입 중 Auth 사용자만 만들어지고 신청 문서 쓰기가 실패한 경우 —
    // 승인 대기 문서를 즉석 재생성해 "이미 등록된 이메일 ↔ 계정 정보 없음" 데드엔드를 제거한다.
    // (2026-09-03 수정) 역할을 무조건 COUNSELOR로 접수하던 탓에 담당자(행정) 신청이 상담사
    // 승인 대기열에 떠서, 마스터가 일반관리 화면에서 승인할 수 없었다. 신청 시 기억해 둔 구분을
    // 우선 사용하고, 알 수 없을 때만 상담사로 접수한다(마스터가 목록에서 구분 변경 가능).
    // 재생성 실패를 삼키면 "접수되었습니다"라고 안내해 놓고 승인 목록에는 뜨지 않아,
    // 사용자가 오지 않을 승인을 무한정 기다린다 (§7.2.1-2, 2026-09-02 점검 [중간-5])
    const requestedRole = recallRequestedRole(email);
    const recovered = await setDoc(doc(db, COL.staff, uid), {
      email,
      name: email.split("@")[0],
      dept: "",
      role: requestedRole === "ADMIN" || requestedRole === "COUNSELOR" ? requestedRole : "COUNSELOR",
      status: "PENDING",
      created_at: new Date().toISOString(),
    })
      .then(() => true)
      .catch(() => false);
    await fbSignOut(auth).catch(() => {});
    return {
      ok: false,
      message: recovered
        ? "계정 신청이 승인 대기 상태로 접수되었습니다. 마스터 승인 후 로그인할 수 있습니다."
        : "계정 정보를 등록하지 못했습니다(네트워크·권한 오류). 잠시 후 다시 로그인해 주시고, 반복되면 담당자에게 문의해 주세요.",
    };
  }
  const s = snap.data() as { name: string; role: AdminRole; status: AccountStatus };
  if (s.status === "PENDING") {
    await fbSignOut(auth).catch(() => {});
    return { ok: false, message: "승인 대기 중인 계정입니다. 승인 후 로그인할 수 있습니다." };
  }
  if (s.status === "DISABLED") {
    await fbSignOut(auth).catch(() => {});
    return { ok: false, message: "비활성화된 계정입니다. 마스터 관리자에게 문의해 주세요." };
  }
  if (s.status === "DELETED") {
    // 삭제 tombstone — 고아 복구로 승인 대기가 재생성되지 않게 명시 차단 (감사 P3-12·C4-10)
    await fbSignOut(auth).catch(() => {});
    return { ok: false, message: "삭제된 계정입니다. 다시 사용하려면 마스터 관리자에게 문의해 주세요." };
  }
  return { ok: true, message: "", session: storeSession(email, s.name, s.role) };
}

export async function login(id: string, password: string): Promise<LoginResult> {
  const normalized = id.trim().toLowerCase();
  try {
    if (CLOUD_ENABLED && normalized.includes("@")) {
      const cloud = await cloudLogin(normalized, password);
      if (cloud) return cloud;
    }
    return await localLogin(normalized, password);
  } catch (e) {
    // 예상 밖 예외를 화면까지 보내지 않는다 — 버튼이 "처리 중"에 고착되던 문제 (점검 A7)
    if (e instanceof StorageBlockedError)
      return {
        ok: false,
        message: "브라우저 저장소가 차단되어 로그인 상태를 유지할 수 없습니다. 시크릿 모드·사이트 데이터 차단을 해제하고 다시 시도해 주세요.",
      };
    if (CLOUD_ENABLED) fbSignOut(getAuthInst()).catch(() => {}); // 세션 없이 Firebase만 로그인된 상태 방지
    return { ok: false, message: "로그인 처리 중 오류가 났습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export function getSession(): AdminSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as AdminSession) : null;
  } catch {
    return null;
  }
}

export function logout(): void {
  sessionStorage.removeItem(SESSION_KEY);
  // 학생 명단 메모리 캐시도 비운다 — 로그아웃 후 실명 명단이 메모리에 남아 다음 로그인(다른 권한)
  // 화면에 그대로 뜨던 문제 (점검 A11/C8). 동적 import — 순환 방지
  void import("./responsesSource").then((m) => m.invalidateStudentsCache());
  if (CLOUD_ENABLED) {
    fbSignOut(getAuthInst()).catch(() => {});
    // 공용 PC 보호 — 로그아웃 후 상담 메모·학생 학번이 localStorage에 평문으로 남아
    // 비로그인 상태에서도 열람 가능하던 문제 수정 (감사 F15). 클라우드가 원본이므로
    // 다음 로그인 시 pullShared가 다시 채운다. (공유 실패분은 저장 시점에 이미 경고됨)
    try {
      localStorage.removeItem("mjc_ready_outreach");
      localStorage.removeItem("mjc_ready_agencies");
      localStorage.removeItem("mjc_ready_agencies_archived");
    } catch {
      /* 제거 실패는 치명적이지 않음 */
    }
  }
}

// ── 계정 관리 (마스터 전용 — 화면단에서 권한 확인 후 호출) ──

export function approveAccount(id: string): AdminAccount[] {
  const accounts = loadAccounts().map((a) =>
    a.id === id && a.status === "PENDING"
      ? { ...a, status: "ACTIVE" as AccountStatus, approved_at: new Date().toISOString() }
      : a
  );
  saveAccounts(accounts);
  return accounts;
}

/** 활성 ↔ 비활성 전환 (마스터 계정은 불가) */
export function toggleAccountActive(id: string): AdminAccount[] {
  const accounts = loadAccounts().map((a) =>
    a.id === id && a.role !== "MASTER" && a.status !== "PENDING"
      ? { ...a, status: (a.status === "ACTIVE" ? "DISABLED" : "ACTIVE") as AccountStatus }
      : a
  );
  saveAccounts(accounts);
  return accounts;
}

/** 계정 삭제 (마스터 계정은 불가) */
export function removeAccount(id: string): AdminAccount[] {
  const accounts = loadAccounts().filter((a) => !(a.id === id && a.role !== "MASTER"));
  saveAccounts(accounts);
  return accounts;
}

// ── 클라우드(ready_staff) 계정 관리 — 화면단에서 권한 확인 후 호출 ──

interface StaffDoc {
  email: string;
  name: string;
  dept: string;
  role: AdminRole;
  status: AccountStatus;
  created_at: string;
  approved_at?: string;
}

/** 클라우드 교직원 목록 — 실패(설정 전·권한 없음) 시 null → 화면은 로컬 목록 사용 */
export async function loadStaffCloud(): Promise<AdminAccount[] | null> {
  if (!CLOUD_ENABLED) return null;
  try {
    await authReady(); // 로그인 복원 대기
    const snap = await getDocs(collection(getDb(), COL.staff));
    const list: AdminAccount[] = [];
    snap.forEach((d) => {
      const s = d.data() as StaffDoc;
      if (s.status === "DELETED") return; // 삭제 tombstone은 목록 비노출
      // 콘솔에서 수기로 만든 문서는 필드가 빠질 수 있다 — created_at 결측 1건이 정렬·렌더에서
      // throw 하면 목록 전체가 로컬 폴백·백지가 됐다 (2026-09-02 점검 A8). 결측은 빈 값으로 보정.
      list.push({
        id: s.email ?? "",
        name: s.name ?? "",
        dept: s.dept ?? "",
        role: s.role,
        status: s.status,
        pw_hash: "",
        created_at: s.created_at ?? "",
        approved_at: s.approved_at,
        uid: d.id,
      });
    });
    return list.sort((a, b) => a.created_at.localeCompare(b.created_at));
  } catch {
    return null;
  }
}

// (2026-09-01 감사 P3-10·C4-12·F16) 계정 액션은 실패를 삼키지 않고 성공 여부를 반환하며,
// 토글이 아니라 "명시적 목표 상태"를 기록한다 — 두 관리자가 동시에 처리해도 결과가 수렴한다.

/** 마스터 직접 등록 (클라우드) — 신청·승인을 거치지 않고 바로 사용 가능한 계정을 만든다.
 *  (2026-09-03) 신청이 관리자에게 전달되지 않는 상황의 우회 경로이자 상시 운영 수단.
 *  Auth 사용자 생성은 격리된 signup 인스턴스에서(마스터 세션 보존, §7.2 Auth 3분리),
 *  staff 문서는 반드시 마스터 세션(getDb)으로 기록한다 — Rules상 status=ACTIVE 생성은
 *  isMaster()만 허용하므로, 갓 생성된 사용자 토큰으로 쓰면 권한 거부된다. */
export async function createStaffCloud(input: {
  email: string;
  name: string;
  dept: string;
  role: AdminRole;
  password: string;
}): Promise<{ ok: boolean; message: string }> {
  const email = input.email.trim().toLowerCase();
  if (!email.includes("@")) return { ok: false, message: "이메일 형식의 아이디를 입력해 주세요." };
  if (!input.name.trim()) return { ok: false, message: "이름을 입력해 주세요." };
  if (input.password.length < 8) return { ok: false, message: "비밀번호는 8자 이상으로 입력해 주세요." };
  if (email === MASTER_ID) return { ok: false, message: "마스터 계정은 등록할 수 없습니다." };

  const signupAuth = getSignupAuth();
  let uid: string;
  try {
    uid = (await createUserWithEmailAndPassword(signupAuth, email, input.password)).user.uid;
  } catch (e) {
    await fbSignOut(signupAuth).catch(() => {});
    const code = (e as { code?: string })?.code ?? "";
    if (code === "auth/email-already-in-use")
      return { ok: false, message: "이미 등록된 이메일입니다. 목록에 없다면 삭제(tombstone)된 계정일 수 있습니다 — 해당 사용자가 로그인하면 승인 대기로 다시 접수됩니다." };
    if (code === "auth/invalid-email") return { ok: false, message: "이메일 형식을 확인해 주세요." };
    if (code === "auth/weak-password") return { ok: false, message: "비밀번호가 너무 단순합니다. 8자 이상으로 다시 입력해 주세요." };
    if (code === "auth/network-request-failed")
      return { ok: false, message: "네트워크 오류로 등록하지 못했습니다. 연결 상태를 확인해 주세요." };
    return { ok: false, message: "계정 생성에 실패했습니다. 잠시 후 다시 시도해 주세요." };
  }
  // 새 사용자로 로그인된 보조 세션을 먼저 정리한 뒤, 마스터 권한으로 문서를 기록한다.
  await fbSignOut(signupAuth).catch(() => {});
  const now = new Date().toISOString();
  try {
    await setDoc(doc(getDb(), COL.staff, uid), {
      email,
      name: input.name.trim(),
      dept: input.dept.trim(),
      role: input.role,
      status: "ACTIVE",
      created_at: now,
      approved_at: now,
    });
  } catch {
    // Auth 사용자만 남은 고아 상태 — 침묵 금지(§7.2.1-2). 당사자 로그인 시 승인 대기로 복구된다.
    return {
      ok: false,
      message: "로그인 계정은 만들어졌지만 권한 정보 저장에 실패했습니다(권한·네트워크). 해당 이메일로 한 번 로그인하면 '승인 대기'로 접수되며, 그때 승인해 주세요.",
    };
  }
  return { ok: true, message: `'${input.name.trim()}' 계정을 등록했습니다 — 바로 로그인할 수 있습니다.` };
}

/** 로컬(시범) 모드 직접 등록 — 이 브라우저 계정 목록에 바로 사용 가능 상태로 추가 */
export async function createLocalAccount(input: {
  id: string;
  name: string;
  dept: string;
  role: AdminRole;
  password: string;
}): Promise<{ ok: boolean; message: string }> {
  const id = input.id.trim().toLowerCase();
  if (!input.name.trim()) return { ok: false, message: "이름을 입력해 주세요." };
  if (input.password.length < 8) return { ok: false, message: "비밀번호는 8자 이상으로 입력해 주세요." };
  if (id === MASTER_ID) return { ok: false, message: "마스터 계정은 등록할 수 없습니다." };
  if (!/^[a-z0-9_.@-]{4,40}$/.test(id))
    return { ok: false, message: "아이디는 영문 소문자·숫자(또는 이메일) 4~40자로 입력해 주세요." };
  const accounts = loadAccounts();
  if (accounts.some((a) => a.id === id)) return { ok: false, message: "이미 사용 중인 아이디입니다." };
  const now = new Date().toISOString();
  accounts.push({
    id,
    name: input.name.trim(),
    dept: input.dept.trim(),
    role: input.role,
    status: "ACTIVE",
    pw_hash: await sha256(input.password),
    created_at: now,
    approved_at: now,
  });
  saveAccounts(accounts);
  return { ok: true, message: `'${input.name.trim()}' 계정을 등록했습니다 — 바로 로그인할 수 있습니다.` };
}

export async function approveStaffCloud(uid: string): Promise<boolean> {
  try {
    await updateDoc(doc(getDb(), COL.staff, uid), {
      status: "ACTIVE",
      approved_at: new Date().toISOString(),
    });
    return true;
  } catch {
    return false;
  }
}

/** 목표 상태(ACTIVE/DISABLED)를 명시적으로 기록 */
export async function setStaffStatusCloud(uid: string, status: "ACTIVE" | "DISABLED"): Promise<boolean> {
  try {
    await updateDoc(doc(getDb(), COL.staff, uid), { status });
    return true;
  } catch {
    return false;
  }
}

/** 구분(역할) 이동 — 담당자(행정) ↔ 상담사. 마스터 전용(Rules에서도 역할 변경은 isMaster()만).
 *  신청이 엉뚱한 대기열에 접수된 계정을 삭제·재신청 없이 옮길 때 사용 (2026-09-03). */
export async function setStaffRoleCloud(uid: string, role: AdminRole): Promise<boolean> {
  try {
    await updateDoc(doc(getDb(), COL.staff, uid), { role });
    return true;
  } catch {
    return false;
  }
}

/** 로컬 모드 구분 이동 */
export function setAccountRole(id: string, role: AdminRole): AdminAccount[] {
  const accounts = loadAccounts().map((a) => (a.id === id && a.role !== "MASTER" ? { ...a, role } : a));
  saveAccounts(accounts);
  return accounts;
}

/** 임명·해제의 목표 역할을 명시적으로 기록 (상담사↔상담사 관리자 / 담당자↔담당자 관리자) */
export async function setStaffLeadCloud(uid: string, role: AdminRole): Promise<boolean> {
  try {
    await updateDoc(doc(getDb(), COL.staff, uid), { role });
    return true;
  } catch {
    return false;
  }
}

/** 클라우드 계정 제거 — 문서 삭제 대신 DELETED tombstone (감사 P3-12: Auth 사용자가 남아
 *  재로그인 시 고아 복구로 부활하던 문제 차단). Auth 사용자 완전 삭제는 콘솔에서. */
export async function removeStaffCloud(uid: string): Promise<boolean> {
  try {
    await updateDoc(doc(getDb(), COL.staff, uid), { status: "DELETED" });
    return true;
  } catch {
    return false;
  }
}

/** 상담사 ↔ 상담사 관리자 역할 전환 (마스터 전용 — 화면단에서 권한 확인 후 호출) */
export function toggleCounselorLead(id: string): AdminAccount[] {
  // (2026-09-03) 담당자 ↔ 담당자 관리자도 같은 방식으로 임명·해제 — leadCounterpart로 일반화
  const accounts = loadAccounts().map((a) => {
    if (a.id !== id) return a;
    const next = leadCounterpart(a.role);
    return next ? { ...a, role: next } : a;
  });
  saveAccounts(accounts);
  return accounts;
}

/** 본인 비밀번호 변경 (마스터 계정 제외) — 클라우드 계정은 재설정 메일 발송 */
/** 클라우드 계정 비밀번호 재설정 메일 — 로그인 화면 "비밀번호 찾기"와 비밀번호 모달이 공용 (점검 A10/C12) */
export async function sendResetMail(id: string): Promise<{ ok: boolean; message: string }> {
  const email = id.trim().toLowerCase();
  if (email === MASTER_ID) return { ok: false, message: "마스터 계정 비밀번호는 화면에서 변경할 수 없습니다." };
  if (!CLOUD_ENABLED || !email.includes("@"))
    return { ok: false, message: "이메일 계정만 재설정 메일을 받을 수 있습니다. 로컬 계정은 마스터에게 문의해 주세요." };
  try {
    await sendPasswordResetEmail(getAuthInst(), email);
    return { ok: true, message: `${email}로 비밀번호 재설정 메일을 보냈습니다. 메일함(스팸함 포함)을 확인해 주세요.` };
  } catch (e) {
    const code = (e as { code?: string })?.code ?? "";
    if (code === "auth/user-not-found") return { ok: false, message: "등록되지 않은 이메일입니다. 아이디를 확인해 주세요." };
    if (code === "auth/invalid-email") return { ok: false, message: "이메일 형식을 확인해 주세요." };
    return { ok: false, message: "재설정 메일 발송에 실패했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

/** 클라우드 세션이 다른 탭·기기에서 끊겼을 때 통지 — "로그인된 화면인데 모든 저장이 실패"하는 상태 방지
 *  (점검 A11/C8). 최초 null(복원 전·로컬 계정)은 무시하고, 사용자가 있다가 사라진 전이만 알린다. */
export function onCloudSignedOut(cb: () => void): () => void {
  if (!CLOUD_ENABLED) return () => {};
  let hadUser = false;
  return onAuthStateChanged(getAuthInst(), (user) => {
    if (user) hadUser = true;
    else if (hadUser) {
      hadUser = false;
      cb();
    }
  });
}

export async function changePassword(id: string, currentPw: string, newPw: string): Promise<{ ok: boolean; message: string }> {
  if (id === MASTER_ID) return { ok: false, message: "마스터 계정 비밀번호는 화면에서 변경할 수 없습니다." };
  if (CLOUD_ENABLED && id.includes("@")) return sendResetMail(id);
  if (newPw.length < 8) return { ok: false, message: "새 비밀번호는 8자 이상으로 입력해 주세요." };
  const accounts = loadAccounts();
  const account = accounts.find((a) => a.id === id);
  if (!account || account.pw_hash !== (await sha256(currentPw)))
    return { ok: false, message: "현재 비밀번호가 올바르지 않습니다." };
  account.pw_hash = await sha256(newPw);
  saveAccounts(accounts);
  return { ok: true, message: "비밀번호가 변경되었습니다." };
}
