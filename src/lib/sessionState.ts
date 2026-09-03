// 세션 상태 영속화 — 키 컨벤션 mjc_ready_* (CLAUDE.md §9)
// 시범 프로토타입: 모든 데이터는 sessionStorage에만 저장 (서버 전송 없음)
import { diagItems } from "./dataLoader";

export interface StudentProfile {
  student_id: string;
  name: string;
  dept: string;
  grade: string;
  phone: string; // 휴대전화 — 상담사 아웃리치(먼저 연락)의 핵심 채널 (2026-08-30 추가)
}

// 학년 코드 (2026-08-31 세분화): "본과1"~"본과3" / "심화1"·"심화2" / "졸업<4자리 연도>" (예: "졸업2024")
// 구버전 값 "1"~"3"(mock·기존 응답)은 gradeLabel이 "N학년"으로 표시해 하위 호환.
export const GRADE_PATTERN = /^본과[1-3]$|^심화[12]$|^졸업(19|20)\d{2}$/;

/** 학년 코드 → 표시 라벨: "본과1"→"본과정 1학년", "심화1"→"전공심화 1학년", "졸업2024"→"졸업(2024)" */
export function gradeLabel(g: string | undefined): string {
  if (!g) return "—";
  if (g.startsWith("졸업")) return g.length > 2 ? `졸업(${g.slice(2)})` : "졸업";
  if (/^본과[0-9]$/.test(g)) return `본과정 ${g.slice(2)}학년`;
  if (/^심화[0-9]$/.test(g)) return `전공심화 ${g.slice(2)}학년`;
  return `${g}학년`;
}

/** 휴대전화 표기 통일 — 숫자만 추려 "010-1234-5678" 하이픈 형식으로. 10자리 미만(형식 불명)은 트림만.
 *  학생 설문 제출과 관리자 연락처 교정이 같은 규칙을 쓴다 — 한쪽만 정규화하면 명단·CSV에 두 형식이
 *  섞이고 Excel이 하이픈 없는 값을 숫자로 읽어 앞 0을 지운다 (2026-09-02 점검 A4). */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 ? `${digits.slice(0, 3)}-${digits.slice(3, -4)}-${digits.slice(-4)}` : raw.trim();
}

export interface CertEntry {
  cert_name: string;
  category?: string; // OA | MAJOR | LANG | DRIVER | ETC — 상담사 활용 분류 (survey_items.certification_entry.category_values)
  status: "OWNED" | "PREPARING" | "TARGET";
}

// 개인정보 고지문 버전 — Start.tsx 고지표(수집 항목·목적·기간·제공·관리 부서) 문구를 바꾸면 날짜를 갱신한다.
// 응답 문서의 consent.terms_version으로 저장돼 "어느 고지문에 동의했는지" 추적 (명세 §7.2 별도 Consent 값)
export const CONSENT_TERMS_VERSION = "2026-09-03";

const KEYS = {
  consent: "mjc_ready_consent",
  consentAt: "mjc_ready_consent_at", // 최초 동의 시각·고지문 버전 (점검 S2)
  profile: "mjc_ready_profile",
  survey: "mjc_ready_survey",
  unscored: "mjc_ready_unscored",
  certs: "mjc_ready_certs",
  diag: "mjc_ready_diag",
  uploaded: "mjc_ready_uploaded", // 클라우드 제출 완료 표시 — 다시 진단 시 함께 초기화
} as const;

function read<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 저장 실패는 치명적이지 않음 (프로토타입) */
  }
}

export interface ConsentInfo {
  at: string; // ISO 일시 — 최초 동의 시각 (같은 세션에서 다시 눌러도 유지)
  terms_version: string;
}
export const setConsent = (v: boolean) => {
  write(KEYS.consent, v);
  if (v) {
    if (!read<ConsentInfo>(KEYS.consentAt))
      write(KEYS.consentAt, { at: new Date().toISOString(), terms_version: CONSENT_TERMS_VERSION });
  } else {
    sessionStorage.removeItem(KEYS.consentAt);
  }
};
export const getConsent = () => read<boolean>(KEYS.consent) === true;
export const getConsentInfo = () => read<ConsentInfo>(KEYS.consentAt);

export const setProfile = (p: StudentProfile) => write(KEYS.profile, p);
export const getProfile = () => read<StudentProfile>(KEYS.profile);

export const setSurvey = (r: Record<string, string>) => write(KEYS.survey, r);
export const getSurvey = () => read<Record<string, string>>(KEYS.survey) ?? {};

export const setUnscored = (r: Record<string, string>) => write(KEYS.unscored, r);
export const getUnscored = () => read<Record<string, string>>(KEYS.unscored) ?? {};

export const setCerts = (c: CertEntry[]) => write(KEYS.certs, c);
export const getCerts = () => read<CertEntry[]>(KEYS.certs) ?? [];

export const setDiag = (r: Record<string, number>) => write(KEYS.diag, r);
export const getDiag = () => read<Record<string, number>>(KEYS.diag) ?? {};

export function clearAll(): void {
  for (const key of Object.values(KEYS)) sessionStorage.removeItem(key);
}

/** 진행 위치 판정 — 이어서 진행 모달용 */
export function getResumeState(): "NONE" | "SURVEY" | "DIAG" | "RESULT" {
  const diag = getDiag();
  const survey = getSurvey();
  // 문항 수는 데이터(diagnostic_bank)에서 — 27 하드코딩 금지 (§4)
  if (Object.keys(diag).length > 0) return Object.keys(diag).length >= diagItems.length ? "RESULT" : "DIAG";
  if (Object.keys(survey).length > 0) return "SURVEY";
  return "NONE";
}
