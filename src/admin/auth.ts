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
} from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection } from "firebase/firestore";
import { CLOUD_ENABLED, COL, getAuthInst, getDb } from "../lib/firebase";

// 역할 체계 (2026-08-30 사용자 확정 — "담당자는 상담사 페이지를 볼 수 없어야 한다"):
//  MASTER          마스터(개발자=사용자) — 양쪽 전부
//  ADMIN           담당자(행정) — 일반 관리 화면 + 엑셀 다운로드만. 상담사 워크스페이스 접근 불가
//  COUNSELOR_LEAD  상담사 관리자 — 상담사 워크스페이스 + 상담사 계정 등록·관리
//  COUNSELOR       상담사 — 상담사 워크스페이스(연락 관리 공유)
export type AdminRole = "MASTER" | "ADMIN" | "COUNSELOR_LEAD" | "COUNSELOR";
export type AccountStatus = "ACTIVE" | "PENDING" | "DISABLED";

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
  ADMIN: "담당자(행정)",
  COUNSELOR_LEAD: "상담사 관리자",
  COUNSELOR: "상담사",
};

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
};

// ── 권한 매트릭스 — 섹션 키 → 접근 가능한 역할 ──
// 관리자 화면(#/admin)은 담당자(행정)·마스터 전용. 상담사 계열은 #/counsel만.
export const SECTION_ROLES: Record<string, AdminRole[]> = {
  overview: ["MASTER", "ADMIN"],
  students: ["MASTER", "ADMIN"],
  recommend: ["MASTER", "ADMIN"],
  download: ["MASTER", "ADMIN"],
  accounts: ["MASTER"],
  // 상담사 워크스페이스(#/counsel) 섹션
  counselStudents: ["MASTER", "COUNSELOR_LEAD", "COUNSELOR"],
  counselAgencies: ["MASTER", "COUNSELOR_LEAD", "COUNSELOR"], // 연계기관·취업처 등록부 (공유 자원)
  counselAccounts: ["MASTER", "COUNSELOR_LEAD"],
};
export const canAccess = (role: AdminRole, section: string): boolean =>
  (SECTION_ROLES[section] ?? []).includes(role);

const ACCOUNTS_KEY = "mjc_ready_admin_accounts";
const SESSION_KEY = "mjc_ready_admin_session";

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
  if (CLOUD_ENABLED && id.includes("@")) {
    const auth = getAuthInst();
    try {
      const cred = await createUserWithEmailAndPassword(auth, id, input.password);
      await setDoc(doc(getDb(), COL.staff, cred.user.uid), {
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
      const code = (e as { code?: string })?.code ?? "";
      if (code === "auth/email-already-in-use") return { ok: false, message: "이미 등록된 이메일입니다." };
      if (code === "auth/invalid-email") return { ok: false, message: "이메일 형식을 확인해 주세요." };
      if (!["auth/operation-not-allowed", "auth/network-request-failed", "auth/configuration-not-found"].includes(code))
        return { ok: false, message: "신청 처리에 실패했습니다. 잠시 후 다시 시도해 주세요." };
      // 프로바이더 미설정·네트워크 장애 → 로컬 등록으로 폴백
    }
  }

  // ── 로컬 경로 ──
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

function storeSession(id: string, name: string, role: AdminRole): AdminSession {
  const session: AdminSession = { id, name, role, login_at: new Date().toISOString() };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
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
    // 프로바이더 미설정·네트워크 장애 → 로컬 인증으로 폴백
    if (["auth/operation-not-allowed", "auth/network-request-failed", "auth/configuration-not-found"].includes(code))
      return null;
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
    await fbSignOut(auth).catch(() => {});
    return { ok: false, message: "계정 정보가 없습니다. 계정 신청을 먼저 진행해 주세요." };
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
  return { ok: true, message: "", session: storeSession(email, s.name, s.role) };
}

export async function login(id: string, password: string): Promise<LoginResult> {
  const normalized = id.trim().toLowerCase();
  if (CLOUD_ENABLED && normalized.includes("@")) {
    const cloud = await cloudLogin(normalized, password);
    if (cloud) return cloud;
  }
  return localLogin(normalized, password);
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
  if (CLOUD_ENABLED) fbSignOut(getAuthInst()).catch(() => {});
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
    const snap = await getDocs(collection(getDb(), COL.staff));
    const list: AdminAccount[] = [];
    snap.forEach((d) => {
      const s = d.data() as StaffDoc;
      list.push({
        id: s.email,
        name: s.name,
        dept: s.dept,
        role: s.role,
        status: s.status,
        pw_hash: "",
        created_at: s.created_at,
        approved_at: s.approved_at,
        uid: d.id,
      });
    });
    return list.sort((a, b) => a.created_at.localeCompare(b.created_at));
  } catch {
    return null;
  }
}

export async function approveStaffCloud(uid: string): Promise<void> {
  await updateDoc(doc(getDb(), COL.staff, uid), {
    status: "ACTIVE",
    approved_at: new Date().toISOString(),
  }).catch(() => {});
}

export async function toggleStaffActiveCloud(uid: string, current: AccountStatus): Promise<void> {
  await updateDoc(doc(getDb(), COL.staff, uid), {
    status: current === "ACTIVE" ? "DISABLED" : "ACTIVE",
  }).catch(() => {});
}

export async function toggleStaffLeadCloud(uid: string, current: AdminRole): Promise<void> {
  if (current !== "COUNSELOR" && current !== "COUNSELOR_LEAD") return;
  await updateDoc(doc(getDb(), COL.staff, uid), {
    role: current === "COUNSELOR" ? "COUNSELOR_LEAD" : "COUNSELOR",
  }).catch(() => {});
}

/** 클라우드 계정 제거 — staff 문서 삭제로 로그인 차단 (Auth 사용자 삭제는 콘솔에서) */
export async function removeStaffCloud(uid: string): Promise<void> {
  await deleteDoc(doc(getDb(), COL.staff, uid)).catch(() => {});
}

/** 상담사 ↔ 상담사 관리자 역할 전환 (마스터 전용 — 화면단에서 권한 확인 후 호출) */
export function toggleCounselorLead(id: string): AdminAccount[] {
  const accounts = loadAccounts().map((a) =>
    a.id === id && (a.role === "COUNSELOR" || a.role === "COUNSELOR_LEAD")
      ? { ...a, role: (a.role === "COUNSELOR" ? "COUNSELOR_LEAD" : "COUNSELOR") as AdminRole }
      : a
  );
  saveAccounts(accounts);
  return accounts;
}

/** 본인 비밀번호 변경 (마스터 계정 제외) — 클라우드 계정은 재설정 메일 발송 */
export async function changePassword(id: string, currentPw: string, newPw: string): Promise<{ ok: boolean; message: string }> {
  if (id === MASTER_ID) return { ok: false, message: "마스터 계정 비밀번호는 화면에서 변경할 수 없습니다." };
  if (CLOUD_ENABLED && id.includes("@")) {
    try {
      await sendPasswordResetEmail(getAuthInst(), id);
      return { ok: true, message: `${id}로 비밀번호 재설정 메일을 보냈습니다. 메일함을 확인해 주세요.` };
    } catch {
      return { ok: false, message: "재설정 메일 발송에 실패했습니다. 잠시 후 다시 시도해 주세요." };
    }
  }
  if (newPw.length < 8) return { ok: false, message: "새 비밀번호는 8자 이상으로 입력해 주세요." };
  const accounts = loadAccounts();
  const account = accounts.find((a) => a.id === id);
  if (!account || account.pw_hash !== (await sha256(currentPw)))
    return { ok: false, message: "현재 비밀번호가 올바르지 않습니다." };
  account.pw_hash = await sha256(newPw);
  saveAccounts(accounts);
  return { ok: true, message: "비밀번호가 변경되었습니다." };
}
