// 날짜 헬퍼 — 검사 실시일·집계 기간·발급일·추천 기간 판정의 단일 기준 (감사 ENG-05 수정)
// ISO 일시(UTC 저장)를 화면·통계에서 쓸 때 반드시 이 함수를 거친다.
// `iso.slice(0, 10)`(UTC 날짜) 사용 금지 — 한국시간 00:00~08:59 제출이 전날로 귀속된다.

/** ISO 일시 → 브라우저 로컬(운영 환경 = KST) 기준 "YYYY-MM-DD". 값이 없거나 파싱 불가면 "" */
export function localDateStr(iso: string | undefined | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 오늘 날짜 "YYYY-MM-DD" (로컬 기준) — 추천활동 활성기간 판정·발급일 표기용 */
export function todayStr(): string {
  return localDateStr(new Date().toISOString());
}
