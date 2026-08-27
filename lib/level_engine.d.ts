// strict TS 대응 타입 선언 — 구현은 level_engine.js (CLAUDE.md §5)
export interface JasResult {
  score: number;
  detail: Record<string, { answer: string | null; score: number }>;
}

export interface Level4Signals {
  met: boolean;
  required_ok: boolean;
  optional_count: number;
}

export interface EvaluationResult {
  level: 1 | 2 | 3 | 4;
  levelName: string;
  routeTag: string;
  consultant: "CAREER" | "EMPLOYMENT";
  jas: number;
  jasDetail: JasResult["detail"];
  jrs: number | null;
  cds: number | null;
  domainScores: Record<string, number | null>;
  gates: { employment: boolean; timing: boolean; level4_signals: Level4Signals };
  reasons: string[];
}

export type SurveyResponses = Record<string, string>;
export type DiagResponses = Record<string, number>;

export function calcJas(surveyResponses: SurveyResponses, surveyItems: unknown): JasResult;
export function calcDomainScores(diagResponses: DiagResponses, diagnosticBank: unknown): Record<string, number | null>;
export function calcIndices(domainScores: Record<string, number | null>, levelRules: unknown): { jrs: number | null; cds: number | null };
export function evaluate(
  surveyResponses: SurveyResponses,
  diagResponses: DiagResponses,
  data: { surveyItems: unknown; diagnosticBank: unknown; levelRules: unknown }
): EvaluationResult;
