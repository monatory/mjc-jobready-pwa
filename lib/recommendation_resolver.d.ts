import type { WeakArea } from "./weak_area";

export interface RecommendationActivity {
  recommendation_code: string;
  name: string;
  owner: "CAREER" | "EMPLOYMENT";
  levels: number[];
  weak_domains: string[];
  priority: number;
  student_desc: string;
  active_from: string;
  active_to: string;
  active: boolean;
  weak_match?: boolean;
}

export function resolveRecommendations(
  level: number,
  weakAreas: WeakArea[],
  master: unknown,
  opts?: { today?: string; max?: number }
): RecommendationActivity[];
