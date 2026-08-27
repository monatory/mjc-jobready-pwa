// 데이터 소스 단일 진입점 — 코드에 배점·문항·규칙 하드코딩 금지 (CLAUDE.md §4)
import surveyItemsJson from "../../data/survey_items.json";
import diagnosticBankJson from "../../data/diagnostic_bank.json";
import levelRulesJson from "../../data/level_rules.json";
import recommendationMasterJson from "../../data/recommendation_master.json";
import resultTemplatesJson from "../../data/result_templates.json";

export const surveyItems = surveyItemsJson;
export const diagnosticBank = diagnosticBankJson;
export const levelRules = levelRulesJson;
export const recommendationMaster = recommendationMasterJson;
export const resultTemplates = resultTemplatesJson;

export interface SurveyOption {
  value: string;
  label: string;
  score?: number;
}

export interface ScoredItem {
  label: string;
  question: string;
  required: boolean;
  roles: string[];
  options: SurveyOption[];
}

export const scoredItemEntries = Object.entries(
  surveyItemsJson.scored_items
) as unknown as Array<[string, ScoredItem]>;

export interface DiagItem {
  id: string;
  domain: string;
  sub_domain: string;
  weight: number;
  text: string;
}

export const diagItems = diagnosticBankJson.items as unknown as DiagItem[];
export const diagScale = diagnosticBankJson.scale as Array<{ value: number; label: string }>;
export const domainLabels = diagnosticBankJson.domains as Record<string, string>;
