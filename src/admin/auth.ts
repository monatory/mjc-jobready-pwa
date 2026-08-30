// 관리자 계정·인증 모듈 (시범 프로토타입 — 로컬 저장소 기반)
// ⚠ 본 구현 시 Firebase Auth + Firestore(권한 문서) + Security Rules로 교체한다.
//   이 모듈은 화면·권한 흐름을 먼저 확정하기 위한 것으로, 저장소 함수만 바꾸면 되도록 분리.
// 비밀번호는 프로토타입에서도 평문 저장 금지 — SHA-256 해시만 보관 (클라이언트 해시는
// 진짜 보안이 아님을 전제로, 실명 데이터 수집 전 반드시 서버 인증 전환 §7.2).

// 역할 체계 (2026-08-30 사용자 확정 — "담당자는 상담사 페이지를 볼 수 없어야 한다"):
//  MASTER          마스터(개발자=사용자) — 양쪽 전부
//  ADMIN           담당자(행정) — 일반 관리 화면 + 엑셀 다운로드만. 상담사 워크스페이스 접근 불가
//  COUNSELOR_LEAD  상담사 관리자 — 상담사 워크스페이스 + 상담사 계정 등록·관리
//  COUNSELOR       상담사 — 상담사 워크스페이스(연락 관리 공유)
export type AdminRole = "MASTER" | "ADMIN" | "COUNSELOR_LEAD" | "COUNSELOR";
export type AccountStatus = "ACTIVE" | "PENDING" | "DISABLED";

export interface AdminAccount {
  id: string;          // 로그인 아이디
  name: string;        // 표시 이름
  dept: string;        // 소속 (선택)
  role: AdminRole;
  status: AccountStatus;
  pw_hash: string;     // SHA-256 hex
  created_at: string;
  approved_at?: string;
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

/** 가입 신청 (일반 관리자·상담사) — 승인 대기 상태로 등록 */
export async function registerAccount(input: {
  id: string;
  name: string;
  dept: string;
  role: Exclude<AdminRole, "MASTER">;
  password: string;
}): Promise<{ ok: boolean; message: string }> {
  // 대소문자만 다른 유사 계정(예: Master) 방지 — 아이디는 소문자로 정규화
  const id = input.id.trim().toLowerCase();
  if (!/^[a-z0-9_.-]{4,20}$/.test(id))
    return { ok: false, message: "아이디는 영문 소문자·숫자 4~20자로 입력해 주세요." };
  if (!input.name.trim()) return { ok: false, message: "이름을 입력해 주세요." };
  if (input.password.length < 8) return { ok: false, message: "비밀번호는 8자 이상으로 입력해 주세요." };
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
  return { ok: true, message: "신청이 접수되었습니다. 마스터 관리자 승인 후 로그인할 수 있습니다." };
}

export async function login(id: string, password: string): Promise<{ ok: boolean; message: string; session?: AdminSession }> {
  await ensureMasterAccount();
  const account = loadAccounts().find((a) => a.id === id.trim().toLowerCase());
  if (!account || account.pw_hash !== (await sha256(password)))
    return { ok: false, message: "아이디 또는 비밀번호가 올바르지 않습니다." };
  if (account.status === "PENDING") return { ok: false, message: "승인 대기 중인 계정입니다. 마스터 관리자에게 승인을 요청해 주세요." };
  if (account.status === "DISABLED") return { ok: false, message: "비활성화된 계정입니다. 마스터 관리자에게 문의해 주세요." };
  const session: AdminSession = {
    id: account.id,
    name: account.name,
    role: account.role,
    login_at: new Date().toISOString(),
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return { ok: true, message: "", session };
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

/** 본인 비밀번호 변경 (마스터 계정은 코드 고정이라 변경 불가) */
export async function changePassword(id: string, currentPw: string, newPw: string): Promise<{ ok: boolean; message: string }> {
  if (id === MASTER_ID) return { ok: false, message: "마스터 계정 비밀번호는 코드에 고정되어 있어 화면에서 변경할 수 없습니다." };
  if (newPw.length < 8) return { ok: false, message: "새 비밀번호는 8자 이상으로 입력해 주세요." };
  const accounts = loadAccounts();
  const account = accounts.find((a) => a.id === id);
  if (!account || account.pw_hash !== (await sha256(currentPw)))
    return { ok: false, message: "현재 비밀번호가 올바르지 않습니다." };
  account.pw_hash = await sha256(newPw);
  saveAccounts(accounts);
  return { ok: true, message: "비밀번호가 변경되었습니다." };
}
