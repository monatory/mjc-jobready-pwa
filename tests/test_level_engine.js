/**
 * Level 판정 엔진 회귀 테스트 — 가상 학생 시나리오 + 경계값.
 * 실행: npm test  (node tests/test_level_engine.js)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { evaluate, calcJas } from "../lib/level_engine.js";
import { findWeakAreas } from "../lib/weak_area.js";
import { resolveRecommendations } from "../lib/recommendation_resolver.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = (f) => JSON.parse(fs.readFileSync(path.join(root, "data", f), "utf8"));

const data = {
  surveyItems: load("survey_items.json"),
  diagnosticBank: load("diagnostic_bank.json"),
  levelRules: load("level_rules.json"),
};
const master = load("recommendation_master.json");

let n = 0;
const test = (name, fn) => {
  n++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${e.message}`);
    process.exitCode = 1;
  }
};

// 진단문항 응답 일괄 생성 헬퍼
const diagAll = (v, overrides = {}) => {
  const r = {};
  for (const item of data.diagnosticBank.items) r[item.id] = v;
  return { ...r, ...overrides };
};

// ── 시나리오 1: 계획서 96점 예시 학생 → Level 3 ─────────────────
const survey96 = {
  career_direction: "EMPLOYMENT",
  job_will: "START_NOW",
  school_support: "ACTIVE",
  employment_timing: "WITHIN_6M",
  gov_link: "USE",
  counsel_wish: "YES",
};

test("계획서 예시: JAS = 96점", () => {
  assert.equal(calcJas(survey96, data.surveyItems).score, 96);
});

test("JAS 96 + 실전신호 없음 → Level 3 (취업준비)", () => {
  const r = evaluate(survey96, diagAll(3), data);
  assert.equal(r.level, 3);
  assert.equal(r.consultant, "EMPLOYMENT");
  assert.equal(r.routeTag, "EMPLOYMENT");
});

// ── 시나리오 2: L3 조건 + 실전 준비신호 → Level 4 ───────────────
test("L3 조건 + 목표직무(JR01)·채용탐색(JR03)·지원서(JR05) ≥ 4 → Level 4", () => {
  const r = evaluate(survey96, diagAll(3, { JR01: 5, JR03: 4, JR05: 4 }), data);
  assert.equal(r.level, 4);
  assert.equal(r.gates.level4_signals.met, true);
});

test("실전신호는 있으나 목표직무(JR01) 미충족 → Level 3 유지", () => {
  const r = evaluate(survey96, diagAll(3, { JR01: 3, JR03: 5, JR05: 5, JR07: 5 }), data);
  assert.equal(r.level, 3);
});

// ── 시나리오 3: 경계값 JAS 69 vs 70 ────────────────────────────
// 취업(30)+천천히(10)+적극(15)+3개월(20)+잘모름(5)+미희망(0) = 80 → 조정해 69/70 구성
const survey70 = {
  career_direction: "EMPLOYMENT", // 30
  job_will: "SLOWLY", // 10
  school_support: "WHEN_NEEDED", // 8
  employment_timing: "WITHIN_3M", // 20
  gov_link: "DONT_KNOW", // 5
  counsel_wish: "NO", // 0  → 합 73
};

test("JAS 73 (컷오프 70 이상) → Level 3", () => {
  const r = evaluate(survey70, diagAll(3), data);
  assert.equal(calcJas(survey70, data.surveyItems).score, 73);
  assert.equal(r.level, 3);
});

test("JAS 68 (컷오프 미달) → Level 2", () => {
  const s = { ...survey70, gov_link: "NO_INTEREST" }; // 73 - 5 = 68
  const r = evaluate(s, diagAll(3), data);
  assert.equal(calcJas(s, data.surveyItems).score, 68);
  assert.equal(r.level, 2);
});

// ── 시나리오 4: 희망시기 Gate — JAS 높아도 1년 이내면 L3 불가 ────
test("JAS ≥ 70이어도 희망시기 1년 → Level 2 (timing Gate)", () => {
  const s = { ...survey96, employment_timing: "WITHIN_1Y" }; // 96-16+8 = 88
  const r = evaluate(s, diagAll(3), data);
  assert.equal(calcJas(s, data.surveyItems).score, 88);
  assert.equal(r.level, 2);
  assert.equal(r.gates.timing, false);
});

// ── 시나리오 5: 비취업 Route — 진학·창업은 승급 금지 ─────────────
test("진학·창업 선택 → Level 2 + Route Tag, JAS 무관하게 L3 승급 없음", () => {
  const s = { ...survey96, career_direction: "FURTHER_STUDY_STARTUP" };
  const r = evaluate(s, diagAll(5), data);
  assert.equal(r.level, 2);
  assert.equal(r.routeTag, "FURTHER_STUDY_STARTUP");
  assert.equal(r.consultant, "CAREER");
});

// ── 시나리오 6: 미정 → Level 1 ─────────────────────────────────
test("진로방향 미정 → Level 1 (진로탐색)", () => {
  const s = {
    career_direction: "UNDECIDED",
    job_will: "UNDECIDED",
    school_support: "ALONE",
    employment_timing: "OTHER",
    gov_link: "NO_INTEREST",
    counsel_wish: "NO",
  };
  const r = evaluate(s, diagAll(2), data);
  assert.equal(r.level, 1);
  assert.equal(r.consultant, "CAREER");
});

// ── 시나리오 7: 취업 방향이지만 JAS·자기이해 모두 낮음 → Level 1 ─
test("취업 방향은 JAS 최저 33 → level1_fallback(JAS<30) 미발동 = Level 2 (설계 문서화, §12-13)", () => {
  const s = {
    career_direction: "EMPLOYMENT", // 30... 조정: OTHER 시기 3 + 나머지 0 → 30+0+0+3+0+0=33. 29 만들기: school ALONE 0, timing OTHER 3 → 33 아님.
  };
  // 취업(30) 단독으로 이미 30 → jas_below(30) 미만이 안 됨. fallback은 배점 구조상
  // "취업 선택 시 JAS < 30 불가"이므로 발동하지 않음을 검증(설계 문서화 목적).
  const full = { career_direction: "EMPLOYMENT", job_will: "UNDECIDED", school_support: "ALONE", employment_timing: "OTHER", gov_link: "NO_INTEREST", counsel_wish: "NO" };
  const r = evaluate(full, diagAll(2), data);
  assert.equal(calcJas(full, data.surveyItems).score, 33);
  assert.equal(r.level, 2); // fallback 미발동 → L2 (방향은 있음)
});

// ── 결정론: 동일 입력 = 동일 출력 ──────────────────────────────
test("결정론 — 동일 입력 2회 평가 결과 완전 일치", () => {
  const a = evaluate(survey96, diagAll(3, { JR01: 5, JR03: 4, JR05: 4 }), data);
  const b = evaluate(survey96, diagAll(3, { JR01: 5, JR03: 4, JR05: 4 }), data);
  assert.deepEqual(a, b);
});

// ── 보완영역 + 추천활동 연계 ───────────────────────────────────
test("보완영역: 가장 낮은 영역 최대 2개 (기준선 3.5 미만)", () => {
  const scores = { SELF: 4.2, CAREER_DIR: 3.8, JOB_INFO: 2.1, COMPETENCY: 3.0, ACTION: 3.6, JOB_READY: 2.8 };
  const weak = findWeakAreas(scores, data.diagnosticBank, data.levelRules.weak_area);
  assert.deepEqual(weak.map((w) => w.domain), ["JOB_INFO", "JOB_READY"]);
});

test("추천활동: Level 3 + 직무정보 취약 → 활성 활동 상위 3개, 취약영역 매칭 우선", () => {
  const weak = [{ domain: "JOB_INFO", label: "직무정보", score: 2.1 }];
  const recs = resolveRecommendations(3, weak, master, { today: "2026-10-01" });
  assert.equal(recs.length, 3);
  assert.ok(recs[0].weak_domains.includes("JOB_INFO")); // 취약영역 직접 매칭이 최상위
  assert.ok(recs.every((a) => a.levels.includes(3) && a.active));
});

test("추천활동: 활성기간 밖이면 제외", () => {
  const recs = resolveRecommendations(3, [], master, { today: "2027-06-01" });
  assert.equal(recs.length, 0);
});

test("추천활동: 결정론 — 동일 조건 동일 순서", () => {
  const weak = [{ domain: "JOB_READY", label: "구직준비", score: 2.5 }];
  const a = resolveRecommendations(4, weak, master, { today: "2026-10-01" });
  const b = resolveRecommendations(4, weak, master, { today: "2026-10-01" });
  assert.deepEqual(a, b);
});

// ── 경계·결측 보강 (2026-09-01 감사 ENG-12) ─────────────────────
test("JAS = 70 (컷오프 동치) → Level 3 진입", () => {
  // 취업(30)+천천히(10)+필요할때(8)+3개월(20)+무관심(0)+미희망(0) = 68 → +잘모름(5)-3? 조합:
  // 취업(30)+바로(20)+알아서(0)+3개월(20)+무관심(0)+미희망(0) = 70
  const s = {
    career_direction: "EMPLOYMENT",
    job_will: "START_NOW",
    school_support: "ALONE",
    employment_timing: "WITHIN_3M",
    gov_link: "NO_INTEREST",
    counsel_wish: "NO",
  };
  assert.equal(calcJas(s, data.surveyItems).score, 70);
  assert.equal(evaluate(s, diagAll(3), data).level, 3);
});

test("결측 진단(빈 diag) — throw 없이 평가되고 결정론 유지 (현행 동작 고정)", () => {
  // Read-Only 엔진(§2)은 결측을 조용히 0점 처리한다 — 유입 차단은 결과지 완주 가드 +
  // rules validResponse(map 타입)가 담당. 여기서는 "동작이 변하지 않음"만 고정한다.
  const a = evaluate(survey96, {}, data);
  const b = evaluate(survey96, {}, data);
  assert.deepEqual(a, b);
  assert.ok([1, 2, 3, 4].includes(a.level));
});

test("추천활동: 활성기간 경계 당일(from·to)은 포함", () => {
  const first = master.activities[0];
  const atFrom = resolveRecommendations(first.levels[0], [], master, { today: first.active_from });
  const atTo = resolveRecommendations(first.levels[0], [], master, { today: first.active_to });
  assert.ok(atFrom.length > 0);
  assert.ok(atTo.length > 0);
});

test("추천활동: ANY 병기 활동도 취약영역 직접 매칭 우선권 유지 (감사 ENG-08 회귀)", () => {
  // 시드에서 EMP_CONSULT_JOBCAFE는 weak_domains에 JOB_READY와 ANY를 함께 가진다 —
  // JOB_READY 취약 학생의 추천에서 직접 매칭(weak_match)으로 인정되어야 한다.
  const weak = [{ domain: "JOB_READY", label: "구직준비", score: 2.5 }];
  const recs = resolveRecommendations(3, weak, master, { today: "2026-10-01" });
  const emp = recs.find((a) => a.recommendation_code === "EMP_CONSULT_JOBCAFE");
  assert.ok(emp, "EMP_CONSULT_JOBCAFE가 추천 상위권에 있어야 함");
  assert.equal(emp.weak_match, true);
});

console.log(`\n총 ${n}건 실행 — ${process.exitCode ? "실패 있음" : "전부 통과"}`);
