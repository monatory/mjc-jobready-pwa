// 세션 상태 영속화 — 키 컨벤션 mjc_ready_* (CLAUDE.md §9)
// 시범 프로토타입: 모든 데이터는 sessionStorage에만 저장 (서버 전송 없음)

export interface StudentProfile {
  student_id: string;
  name: string;
  dept: string;
  grade: string;
}

export interface CertEntry {
  cert_name: string;
  category?: string; // OA | MAJOR | LANG | ETC — 상담사 활용 분류 (survey_items.certification_entry.category_values)
  status: "OWNED" | "PREPARING" | "TARGET";
}

const KEYS = {
  consent: "mjc_ready_consent",
  profile: "mjc_ready_profile",
  survey: "mjc_ready_survey",
  unscored: "mjc_ready_unscored",
  certs: "mjc_ready_certs",
  diag: "mjc_ready_diag",
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

export const setConsent = (v: boolean) => write(KEYS.consent, v);
export const getConsent = () => read<boolean>(KEYS.consent) === true;

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
  if (Object.keys(diag).length > 0) return Object.keys(diag).length >= 27 ? "RESULT" : "DIAG";
  if (Object.keys(survey).length > 0) return "SURVEY";
  return "NONE";
}
