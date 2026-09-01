/**
 * 데이터 무결성 검증 (CI 게이트) — 계획서 §2-③ 데이터 거버넌스.
 * 데이터를 읽기만 하며 절대 수정하지 않는다. 실패 시 exit 1.
 *
 * 사용: npm run validate:data   /   node scripts/validate-data.mjs --verbose
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = (f) => JSON.parse(fs.readFileSync(path.join(root, "data", f), "utf8"));

const survey = load("survey_items.json");
const rules = load("level_rules.json");
const bank = load("diagnostic_bank.json");
const master = load("recommendation_master.json");
const templates = load("result_templates.json");
const excel = load("excel_columns.json");

const verbose = process.argv.includes("--verbose");
let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  if (ok) {
    pass++;
    if (verbose) console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? " — " + detail : ""}`);
  }
}

console.log("[1] 기본 설문 배점표");
{
  const maxSum = Object.values(survey.scored_items).reduce(
    (s, item) => s + Math.max(...item.options.map((o) => o.score)),
    0
  );
  check(`배점 만점 합계 = jas_max(${survey.jas_max})`, maxSum === survey.jas_max, `실제 ${maxSum}`);
  for (const [key, item] of Object.entries(survey.scored_items)) {
    const values = item.options.map((o) => o.value);
    check(`${key} 선택값 중복 없음`, new Set(values).size === values.length);
    check(`${key} 배점 음수 없음`, item.options.every((o) => o.score >= 0));
    check(`${key} roles에 SCORE 포함`, item.roles.includes("SCORE"));
  }
  const consent = survey.unscored_items.consent_view;
  check("정보열람 동의는 비점수 항목(CONSENT)", consent && consent.roles.includes("CONSENT"));
}

console.log("[2] Level 판정 규칙");
{
  const allItems = { ...survey.scored_items, ...survey.unscored_items };
  for (const [name, gate] of Object.entries(rules.gates)) {
    const item = allItems[gate.item];
    check(`gate ${name} → 설문항목 존재(${gate.item})`, !!item);
    if (item && item.options)
      check(
        `gate ${name} 값이 선택지에 존재`,
        gate.values.every((v) => item.options.some((o) => o.value === v))
      );
  }
  check("JAS 컷오프가 0~100 범위", rules.jas_cutoff_level3 > 0 && rules.jas_cutoff_level3 <= 100);
  const bankIds = new Set(bank.items.map((i) => i.id));
  const sig = rules.level4_signals;
  check(
    "L4 신호 문항이 진단은행에 존재",
    [...sig.required_items, ...sig.optional_items].every((id) => bankIds.has(id))
  );
  check("L4 필수 신호 문항은 critical=true", sig.required_items.every((id) => bank.items.find((i) => i.id === id)?.critical === true));
  check("Level 1~4 정의 존재", ["1", "2", "3", "4"].every((l) => rules.levels[l]?.name));
  check("Level별 상담 연계 정의", ["1", "2", "3", "4"].every((l) => ["CAREER", "EMPLOYMENT"].includes(rules.consultant_by_level[l])));
  check(
    "JRS·CDS 영역이 진단 domains에 존재",
    [...rules.score_scale.jrs_domains, ...rules.score_scale.cds_domains].every((d) => bank.domains[d])
  );
}

console.log("[3] 보조 진단문항");
{
  const ids = bank.items.map((i) => i.id);
  check("문항 ID 중복 없음", new Set(ids).size === ids.length);
  check(`문항 수 24~30개 (현재 ${ids.length})`, ids.length >= 24 && ids.length <= 30);
  check("모든 문항 domain 유효", bank.items.every((i) => bank.domains[i.domain]));
  check("모든 문항 weight > 0", bank.items.every((i) => i.weight > 0));
  check("모든 문항 텍스트 존재", bank.items.every((i) => i.text && i.text.trim().length >= 5));
  const codes = new Set(master.activities.map((a) => a.recommendation_code));
  const badAction = bank.items.filter((i) => i.action_code && !codes.has(i.action_code));
  check("action_code ↔ Recommendation Master 참조 무결성", badAction.length === 0, badAction.map((i) => i.id).join(","));
}

console.log("[4] Recommendation Master");
{
  const codes = master.activities.map((a) => a.recommendation_code);
  check("추천코드 중복 없음", new Set(codes).size === codes.length);
  check("적용 Level 유효(1~4)", master.activities.every((a) => a.levels.every((l) => l >= 1 && l <= 4)));
  check(
    "weak_domains 유효(도메인 또는 ANY)",
    master.activities.every((a) => a.weak_domains.every((d) => d === "ANY" || bank.domains[d]))
  );
  check("우선순위 1~5", master.activities.every((a) => a.priority >= 1 && a.priority <= 5));
  check("담당 CAREER/EMPLOYMENT", master.activities.every((a) => ["CAREER", "EMPLOYMENT"].includes(a.owner)));
  check("활성기간 형식(YYYY-MM-DD)", master.activities.every((a) => /^\d{4}-\d{2}-\d{2}$/.test(a.active_from) && /^\d{4}-\d{2}-\d{2}$/.test(a.active_to)));
  for (const l of [1, 2, 3, 4])
    check(`Level ${l} 대상 활성 활동 1개 이상`, master.activities.some((a) => a.active && a.levels.includes(l)));
}

console.log("[5] 결과 템플릿·Excel 정의");
{
  check("Level 1~4 템플릿 존재", ["1", "2", "3", "4"].every((l) => templates.levels[l]?.title && templates.levels[l]?.body));
  check("진학·창업 Route 템플릿 존재", !!templates.route_overrides?.FURTHER_STUDY_STARTUP);
  check("법적 안내 문구 존재", typeof templates.legal_footer === "string" && templates.legal_footer.length > 10);
  const sheetNames = Object.keys(excel.sheets);
  check(`Excel Sheet 5종 (현재 ${sheetNames.length})`, sheetNames.length === 5);
  check("모든 Sheet 컬럼 key·label 존재", sheetNames.every((s) => excel.sheets[s].every((c) => c.key && c.label)));
  check("01_학생상태에 학번·성명·Level 포함", ["student_id", "name", "level"].every((k) => excel.sheets["01_학생상태"]?.some((c) => c.key === k)));
  check("03_자격증현황 Long Format 필수 컬럼", ["student_id", "cert_name", "status"].every((k) => excel.sheets["03_자격증현황"]?.some((c) => c.key === k)));
}

console.log("[6] 무결성 보강 (2026-09-01 감사 ENG-11)");
{
  // 비점수 항목 선택값·라벨 중복 — 중복 값은 응답 저장·라벨 변환을 오염시킨다
  for (const [key, item] of Object.entries(survey.unscored_items)) {
    if (!item.options) continue;
    const values = item.options.map((o) => o.value);
    check(`unscored ${key} 선택값 중복 없음`, new Set(values).size === values.length);
  }
  // visible_if 참조 무결성 — 참조 항목·값이 실제로 존재해야 조건부 노출이 동작
  const allItems = { ...survey.scored_items, ...survey.unscored_items };
  const badVisible = Object.entries(survey.unscored_items)
    .filter(([, item]) => item.visible_if)
    .filter(([, item]) => {
      const target = allItems[item.visible_if.item];
      return !target || !target.options?.some((o) => o.value === item.visible_if.value);
    })
    .map(([k]) => k);
  check("visible_if 참조 무결성 (항목·값 존재)", badVisible.length === 0, badVisible.join(","));
  // multi(복수 선택) 항목 값에 콤마 금지 — 콤마 결합 저장 형식과 충돌
  const badMulti = Object.entries(survey.unscored_items)
    .filter(([, item]) => item.multi && item.options)
    .filter(([, item]) => item.options.some((o) => o.value.includes(",")))
    .map(([k]) => k);
  check("multi 항목 선택값에 콤마 없음", badMulti.length === 0, badMulti.join(","));
  // 추천활동 활성기간 역전 금지
  check(
    "추천활동 활성기간 from ≤ to",
    master.activities.every((a) => a.active_from <= a.active_to)
  );
  // level1_fallback 참조 도메인 존재
  check(
    "level1_fallback self_domain이 진단 domains에 존재",
    !rules.level1_fallback || !!bank.domains[rules.level1_fallback.self_domain]
  );
  // 진단 척도 값 1~5 연속
  check(
    "진단 척도 1~5 정의",
    Array.isArray(bank.scale) && [1, 2, 3, 4, 5].every((v) => bank.scale.some((s) => s.value === v))
  );
}

console.log(`\n검증 완료: 통과 ${pass}건 / 실패 ${fail}건`);
if (fail > 0) process.exit(1);
