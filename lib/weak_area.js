/**
 * 보완영역(취약영역) 추출 — 영역평균이 기준선 미만인 영역을 낮은 순으로 최대 N개.
 * 규칙 값은 data/level_rules.json weak_area에서 주입.
 */
export function findWeakAreas(domainScores, diagnosticBank, weakRule) {
  return Object.entries(domainScores)
    .filter(([, v]) => v != null && v < weakRule.threshold)
    .sort((a, b) => a[1] - b[1])
    .slice(0, weakRule.max_count)
    .map(([domain, score]) => ({
      domain,
      label: diagnosticBank.domains[domain] ?? domain,
      score,
    }));
}
