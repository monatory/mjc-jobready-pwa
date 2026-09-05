/**
 * MJC 진로·취업 상태진단 — Level 판정 엔진 (결정론)
 *
 * 원칙 (계획서 §2·§4, CLAUDE.md §2 Read-Only):
 *  - AI API 없이 배점·Gate 규칙만으로 동일 응답 = 동일 Level 재현
 *  - 배점·컷오프·조건은 전부 data/에서 주입 (하드코딩 금지)
 *  - 판정근거(reasons)를 함께 반환하여 관리자 화면·감사에 사용
 */

/** 기본 설문 응답 → JAS(구직활성도, 0~100) 산출 */
export function calcJas(surveyResponses, surveyItems) {
  const detail = {};
  let score = 0;
  for (const [key, item] of Object.entries(surveyItems.scored_items)) {
    const answer = surveyResponses[key];
    const opt = item.options.find((o) => o.value === answer);
    const s = opt ? opt.score : 0; // 미응답·미상값은 0점 (보수적 처리)
    detail[key] = { answer: answer ?? null, score: s };
    score += s;
  }
  return { score, detail };
}

/** 진단문항 응답 → 영역별 가중평균(1~5). 미응답 문항은 해당 영역 계산에서 제외 */
export function calcDomainScores(diagResponses, diagnosticBank) {
  const acc = {}; // domain → {sum, weight}
  for (const item of diagnosticBank.items) {
    const v = diagResponses[item.id];
    if (typeof v !== "number" || v < 1 || v > 5) continue;
    const a = (acc[item.domain] ??= { sum: 0, weight: 0 });
    a.sum += v * item.weight;
    a.weight += item.weight;
  }
  const scores = {};
  for (const domain of Object.keys(diagnosticBank.domains)) {
    const a = acc[domain];
    scores[domain] = a && a.weight > 0 ? Math.round((a.sum / a.weight) * 100) / 100 : null;
  }
  return scores;
}

/** 영역점수 → JRS·CDS (0~100 환산). 해당 영역 무응답이면 null */
export function calcIndices(domainScores, levelRules) {
  const avgOf = (domains) => {
    const vals = domains.map((d) => domainScores[d]).filter((v) => v != null);
    if (!vals.length) return null;
    return Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 20);
  };
  return {
    jrs: avgOf(levelRules.score_scale.jrs_domains),
    cds: avgOf(levelRules.score_scale.cds_domains),
  };
}

/** Gate 충족 여부 */
function gatePassed(gate, surveyResponses) {
  return gate.values.includes(surveyResponses[gate.item]);
}

/** Level 4 실전 준비신호 충족 여부 */
function level4SignalsMet(signals, diagResponses) {
  // 척도 범위(1~5) 밖의 값(콘솔 수기 편집·이관 오류)은 calcDomainScores와 동일하게 무효로 본다 —
  // 예전엔 6 같은 이상값이 "충족"으로 집계됐다 (2026-09-05 점검). 유효 입력의 판정은 바뀌지 않는다.
  const hit = (id) => {
    const v = diagResponses[id];
    return typeof v === "number" && v >= 1 && v <= 5 && v >= signals.answer_at_least;
  };
  const requiredOk = signals.required_items.every(hit);
  const optionalCount = signals.optional_items.filter(hit).length;
  return {
    met: requiredOk && optionalCount >= signals.optional_min_count,
    required_ok: requiredOk,
    optional_count: optionalCount,
  };
}

/**
 * 종합 판정.
 * @returns {{level, levelName, routeTag, consultant, jas, jasDetail, jrs, cds, domainScores, gates, reasons}}
 */
export function evaluate(surveyResponses, diagResponses, data) {
  const { surveyItems, diagnosticBank, levelRules } = data;
  const reasons = [];

  const { score: jas, detail: jasDetail } = calcJas(surveyResponses, surveyItems);
  const domainScores = calcDomainScores(diagResponses, diagnosticBank);
  const { jrs, cds } = calcIndices(domainScores, levelRules);

  const direction = surveyResponses.career_direction ?? "UNDECIDED";
  const empGate = gatePassed(levelRules.gates.employment_gate, surveyResponses);
  const timingGate = gatePassed(levelRules.gates.timing_gate, surveyResponses);
  const signals = level4SignalsMet(levelRules.level4_signals, diagResponses);

  let level;
  let routeTag = direction;

  if (direction === "FURTHER_STUDY_STARTUP") {
    // 비취업 Route: L3~4 자동 승급 금지 (계획서 §4)
    level = 2;
    reasons.push("진로방향=진학·창업 → 비취업 Route (Level 3~4 승급 제외, 진로설정 단계로 관리)");
  } else if (direction === "UNDECIDED") {
    level = 1;
    reasons.push("진로방향 미정 → 진로탐색 단계");
  } else {
    // 취업 Route
    if (empGate && timingGate && jas >= levelRules.jas_cutoff_level3) {
      if (signals.met) {
        level = 4;
        reasons.push(
          `L3 조건 충족(JAS ${jas} ≥ ${levelRules.jas_cutoff_level3}, 희망시기 Gate 통과) + 실전 준비신호 충족(필수 ${signals.required_ok ? "OK" : "미충족"} · 선택 ${signals.optional_count}개)`
        );
      } else {
        level = 3;
        reasons.push(`취업 Gate + JAS ${jas} ≥ ${levelRules.jas_cutoff_level3} + 졸업 전~6개월 이내 취업의사 → 취업준비 단계`);
        if (!signals.required_ok) reasons.push("Level 4 미충족: 목표직무 구체화 신호 부족");
        else reasons.push(`Level 4 미충족: 실전 준비신호 ${signals.optional_count}/${levelRules.level4_signals.optional_min_count}개`);
      }
    } else {
      const fb = levelRules.level1_fallback;
      const selfAvg = domainScores[fb.self_domain];
      if (jas < fb.jas_below && selfAvg != null && selfAvg < fb.self_avg_below) {
        level = 1;
        reasons.push(`취업 방향이나 JAS ${jas} < ${fb.jas_below} + 자기이해 ${selfAvg} < ${fb.self_avg_below} → 진로탐색 단계`);
      } else {
        level = 2;
        if (!timingGate) reasons.push("취업 희망시기가 6개월 초과 → 진로설정 단계에서 구체화 지원");
        if (jas < levelRules.jas_cutoff_level3) reasons.push(`JAS ${jas} < ${levelRules.jas_cutoff_level3} → Level 3 기준 미달`);
      }
    }
  }

  return {
    level,
    levelName: levelRules.levels[String(level)].name,
    routeTag,
    consultant: levelRules.consultant_by_level[String(level)],
    jas,
    jasDetail,
    jrs,
    cds,
    domainScores,
    gates: { employment: empGate, timing: timingGate, level4_signals: signals },
    reasons,
  };
}
