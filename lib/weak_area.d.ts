export interface WeakArea {
  domain: string;
  label: string;
  score: number;
}

export function findWeakAreas(
  domainScores: Record<string, number | null>,
  diagnosticBank: unknown,
  weakRule: { threshold: number; max_count: number }
): WeakArea[];
