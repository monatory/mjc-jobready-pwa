// 가상 학생 40명 생성 — 실제 판정 엔진(evaluate)을 통과시킨 미리보기 데이터.
// 시드 고정 LCG → 새로고침해도 동일한 명단(결정론). Firestore 연동 전 대시보드 검증용.
import { evaluate, type EvaluationResult } from "../../lib/level_engine.js";
import { findWeakAreas, type WeakArea } from "../../lib/weak_area.js";
import {
  resolveRecommendations,
  type RecommendationActivity,
} from "../../lib/recommendation_resolver.js";
import {
  surveyItems,
  diagnosticBank,
  levelRules,
  recommendationMaster,
  diagItems,
} from "../lib/dataLoader";

export interface StudentRecord {
  student_id: string;
  name: string;
  dept: string;
  grade: string;
  semester: string;
  survey: Record<string, string>;
  unscored: Record<string, string>;
  certs: Array<{ cert_name: string; category?: string; status: string }>;
  diag: Record<string, number>;
  result: EvaluationResult;
  weak: WeakArea[];
  recs: RecommendationActivity[];
  completed_at: string;
}

// 시드 고정 의사난수
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const rng = makeRng(20260827);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
const weighted = <T,>(pairs: Array<[T, number]>): T => {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [v, w] of pairs) {
    r -= w;
    if (r <= 0) return v;
  }
  return pairs[pairs.length - 1][0];
};

const NAMES = [
  "김민서", "이지훈", "박수아", "최건우", "정예린", "강도현", "윤서연", "임재원",
  "한소율", "오시우", "서하은", "신준호", "황지민", "안유진", "송민재", "전다은",
  "홍성민", "고은채", "문지호", "양세아", "배현우", "조아인", "백승민", "남주하",
  "심규진", "노윤아", "하태민", "구서진", "우지원", "변가은", "석지환", "표나연",
  "명준서", "탁하린", "제갈민", "육성재", "감다현", "옥지수", "범준영", "설아름",
];

const DEPTS = [
  "컴퓨터공학과", "AI게임소프트웨어학과", "정보통신공학과", "기계공학과", "전기공학과",
  "경영학과", "세무회계과", "사회복지과", "관광경영학과", "뷰티매니지먼트과",
];

const CERT_POOL: Array<{ name: string; category: string }> = [
  { name: "정보처리산업기사", category: "MAJOR" },
  { name: "컴퓨터활용능력 2급", category: "OA" },
  { name: "컴퓨터활용능력 1급", category: "OA" },
  { name: "ITQ 엑셀", category: "OA" },
  { name: "워드프로세서", category: "OA" },
  { name: "전산회계 1급", category: "MAJOR" },
  { name: "사회복지사 2급", category: "MAJOR" },
  { name: "미용사(일반)", category: "MAJOR" },
  { name: "전기기능사", category: "MAJOR" },
  { name: "TOEIC 700+", category: "LANG" },
  { name: "JLPT N2", category: "LANG" },
  { name: "지게차운전기능사", category: "ETC" },
  { name: "SMAT 2급", category: "ETC" },
];

function makeStudent(i: number): StudentRecord {
  const direction = weighted<string>([
    ["EMPLOYMENT", 0.62],
    ["UNDECIDED", 0.22],
    ["FURTHER_STUDY_STARTUP", 0.16],
  ]);

  // 취업 성향일수록 적극 응답이 나오도록 편향
  const active = direction === "EMPLOYMENT" ? rng() : rng() * 0.6;

  const survey: Record<string, string> = {
    career_direction: direction,
    job_will: active > 0.6 ? "START_NOW" : active > 0.3 ? "SLOWLY" : "UNDECIDED",
    school_support: active > 0.55 ? "ACTIVE" : active > 0.25 ? "WHEN_NEEDED" : "ALONE",
    employment_timing:
      active > 0.65 ? "WITHIN_3M" : active > 0.45 ? "WITHIN_6M" : active > 0.25 ? "WITHIN_1Y" : "OTHER",
    gov_link: active > 0.5 ? "USE" : active > 0.25 ? "DONT_KNOW" : "NO_INTEREST",
    counsel_wish: rng() > 0.45 ? "YES" : "NO",
  };

  const majorLink = rng() > 0.35 ? "Y" : "N";
  const jobGroups = ["OFFICE_ADMIN", "ACCOUNTING", "SAFETY_FACILITY", "SERVICE", "MAJOR_FIELD", "IT_DESIGN"];
  const groupPick = [pick(jobGroups)];
  if (rng() > 0.6) groupPick.push(pick(jobGroups.filter((g) => g !== groupPick[0])));
  const unscored: Record<string, string> = {
    home_region: pick(["SEOUL", "GYEONGGI", "INCHEON", "OTHER"]),
    region: rng() > 0.7 ? "SEOUL,GYEONGGI" : pick(["SEOUL", "GYEONGGI", "INCHEON", "OTHER"]),
    major_link: majorLink,
    desired_job_group:
      direction === "EMPLOYMENT" ? groupPick.join(",") : direction === "UNDECIDED" && rng() > 0.4 ? "UNDECIDED" : "",
    desired_job: direction === "EMPLOYMENT" ? pick(["웹 개발자", "사무행정", "사회복지사", "마케터", "설비 엔지니어", "회계사무원", "뷰티 아티스트", "게임 QA"]) : "",
    ...(majorLink === "N"
      ? {
          career_shift_timing: pick(["BEFORE_ENTRY", "YEAR_1", "YEAR_2", "FINAL_YEAR"]),
          career_shift_reason: pick(["MAJOR_MARKET", "INTEREST", "EXPERIENCE", "CONDITIONS"]),
        }
      : {}),
    prep_difficulty: pick(["NO_INFO", "CERT_BURDEN", "NO_EXPERIENCE", "NO_TIME", "COST", "NONE"]),
    roadmap_demand: pick(["WILL_USE", "WILL_USE", "MAYBE", "NO_NEED"]),
  };

  const diag: Record<string, number> = {};
  const base = 1.5 + active * 2.5; // 1.5~4.0
  for (const q of diagItems) {
    const domainBias = q.domain === "JOB_READY" ? active * 1.6 - 0.4 : 0;
    const v = Math.round(base + domainBias + (rng() - 0.5) * 2);
    diag[q.id] = Math.min(5, Math.max(1, v));
  }

  // 자격증 0~3건 — 필터 시연이 쉽도록 보유율을 실감나게(약 75%) 생성
  const certs: Array<{ cert_name: string; category: string; status: string }> = [];
  const certCount = rng() > 0.75 ? 0 : rng() > 0.5 ? 1 : rng() > 0.35 ? 2 : 3;
  const pool = [...CERT_POOL];
  for (let c = 0; c < certCount && pool.length > 0; c++) {
    const idx = Math.floor(rng() * pool.length);
    const [cert] = pool.splice(idx, 1);
    certs.push({
      cert_name: cert.name,
      category: cert.category,
      status: weighted([["OWNED", 0.45], ["PREPARING", 0.35], ["TARGET", 0.2]]),
    });
  }

  const result = evaluate(survey, diag, { surveyItems, diagnosticBank, levelRules });
  const weak = findWeakAreas(
    result.domainScores,
    diagnosticBank,
    (levelRules as unknown as { weak_area: { threshold: number; max_count: number } }).weak_area
  );
  const recs = resolveRecommendations(result.level, weak, recommendationMaster, {
    today: "2026-08-27",
  });

  const day = 1 + Math.floor(rng() * 14);
  return {
    student_id: String(20260000 + 100 * (i % 10) + i + 1),
    name: NAMES[i % NAMES.length],
    dept: DEPTS[i % DEPTS.length],
    grade: pick(["1", "2", "3"]),
    semester: "2026-2",
    survey,
    unscored,
    certs,
    diag,
    result,
    weak,
    recs,
    completed_at: `2026-08-${String(13 + Math.floor(day / 2)).padStart(2, "0")}T1${day % 10}:0${i % 6}:00`,
  };
}

export const mockStudents: StudentRecord[] = Array.from({ length: 40 }, (_, i) => makeStudent(i));

/** 설문 응답 코드 → 표시 라벨 */
export function surveyAnswerLabel(itemKey: string, value: string | undefined): string {
  if (!value) return "—";
  const all = {
    ...(surveyItems.scored_items as Record<string, { options?: Array<{ value: string; label: string }> }>),
    ...(surveyItems.unscored_items as Record<string, { options?: Array<{ value: string; label: string }> }>),
  };
  const options = all[itemKey]?.options;
  if (!options) return value;
  // 복수 선택(multi) 항목은 콤마 결합 값 — 각각 라벨로 변환해 " · "로 연결
  return value
    .split(",")
    .filter(Boolean)
    .map((v) => options.find((o) => o.value === v)?.label ?? v)
    .join(" · ");
}
