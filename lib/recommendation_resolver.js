/**
 * 추천활동 조회 — Recommendation Master에서 Level·취약영역·활성 조건으로 필터링.
 * 생성형 AI 임의 생성 금지(계획서 §5): 등록된 활동만 반환한다.
 *
 * @param {number} level              판정된 Level (1~4)
 * @param {Array<{domain:string}>} weakAreas  findWeakAreas 결과
 * @param {object} master             recommendation_master.json (또는 Firestore 스냅샷)
 * @param {object} [opts]             {today?: "YYYY-MM-DD", max?: number}
 */
export function resolveRecommendations(level, weakAreas, master, opts = {}) {
  const max = opts.max ?? 3;
  const today = opts.today ?? null; // null이면 기간 필터 생략(테스트 재현성)
  const weakSet = new Set(weakAreas.map((w) => w.domain));

  const inPeriod = (a) => {
    if (!today) return true;
    return a.active_from <= today && today <= a.active_to;
  };
  // 취약영역 "직접" 매칭 — ANY는 범용 노출 표식일 뿐이므로 판정에서 제외하고 실제 영역만 본다.
  // (구현 이력: ANY가 함께 등록된 활동이 직접 매칭 우선권을 통째로 잃던 결함 수정 — 감사 ENG-08)
  const matchWeakDirect = (a) => a.weak_domains.some((d) => d !== "ANY" && weakSet.has(d));

  return master.activities
    .filter((a) => a.active && a.levels.includes(level) && inPeriod(a))
    .map((a) => ({ ...a, weak_match: matchWeakDirect(a) }))
    .sort((a, b) => {
      // 취약영역 직접 매칭 우선 → 우선순위 오름차순 → 코드순(결정론 보장)
      if (a.weak_match !== b.weak_match) return a.weak_match ? -1 : 1;
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.recommendation_code.localeCompare(b.recommendation_code);
    })
    .slice(0, max);
}
