export const SECTION_TITLES = {
  executive: "Executive Financial Summary",
  assets: "Asset Composition",
  liabilities: "Liabilities and Financial Exposure",
  changes: "Net Worth Changes",
  strengths: "Financial Strengths",
  attention: "Areas Requiring Attention",
  questions: "Questions to Consider",
  limitations: "Data Limitations",
} as const;
export type SectionId = keyof typeof SECTION_TITLES;
export type DemoScope = "individual" | "consolidated";
export type Metric = { id: string; label: string; value: number | null; unit: "currency" | "percent" | "count" };
export type ValidatedFinancialSummary = {
  version: "1";
  source: "synthetic-demo" | "trusted-server";
  scope: { kind: DemoScope; investorCount: number };
  reportingPeriod: { current: string; previous: string };
  currency: string;
  dataVersion: string;
  metrics: Metric[];
  limitations: string[];
};
export type FinancialInsights = {
  sections: { id: SectionId; narrative: string; metricIds: string[]; limitations: string[] }[];
  questions: { text: string; metricIds: string[] }[];
};
export type AnalysisUsage = { inputTokens: number; outputTokens: number; estimatedCostUsd: number | null; latencyMs: number };
export type AnalysisResult = {
  source: "demonstration";
  summary: ValidatedFinancialSummary;
  insights: FinancialInsights;
  usage: AnalysisUsage;
  cached: boolean;
};
export const DISCLOSURE = "AI-generated financial commentary based on the information provided. Figures are derived from ADAVI's financial calculations. This analysis is informational and does not constitute personalized financial, investment, tax, or legal advice.";

export class InsightsError extends Error {
  constructor(public readonly code: string, public readonly status = 400) {
    super(code);
    this.name = "InsightsError";
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InsightsError("INVALID_RESPONSE", 502);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[]) {
  if (Object.keys(value).length !== expected.length || expected.some(key => !(key in value))) throw new InsightsError("INVALID_RESPONSE", 502);
}
function text(value: unknown, max = 800): string {
  // Figures appear only in deterministic metric cards. Never render model HTML,
  // links, invented amounts, percentages, or scores as authoritative information.
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\d<>$€£¥%\u0000-\u001f]|https?:\/\//i.test(value)) throw new InsightsError("INVALID_RESPONSE", 502);
  if (/(?:you should|we recommend|recommend that you)\s+(?:buy|sell|hold)\b/i.test(value)) throw new InsightsError("INVALID_RESPONSE", 502);
  return value;
}
function references(value: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8 || value.some(id => typeof id !== "string" || !allowed.has(id)) || new Set(value).size !== value.length) throw new InsightsError("INVALID_METRIC_REFERENCE", 502);
  return value as string[];
}
export function validateInsights(value: unknown, summary: ValidatedFinancialSummary): FinancialInsights {
  const root = object(value);
  keys(root, ["sections", "questions"]);
  if (!Array.isArray(root.sections) || root.sections.length !== 8 || !Array.isArray(root.questions) || root.questions.length < 3 || root.questions.length > 5) throw new InsightsError("INVALID_RESPONSE", 502);
  const allowed = new Set(summary.metrics.map(metric => metric.id));
  const seen = new Set<string>();
  const sections = root.sections.map(raw => {
    const section = object(raw);
    keys(section, ["id", "narrative", "metricIds", "limitations"]);
    if (typeof section.id !== "string" || !Object.hasOwn(SECTION_TITLES, section.id) || seen.has(section.id)) throw new InsightsError("INVALID_RESPONSE", 502);
    seen.add(section.id);
    if (!Array.isArray(section.limitations) || section.limitations.length > 5) throw new InsightsError("INVALID_RESPONSE", 502);
    return { id: section.id as SectionId, narrative: text(section.narrative), metricIds: references(section.metricIds, allowed), limitations: section.limitations.map(item => text(item, 400)) };
  });
  const questions = root.questions.map(raw => {
    const question = object(raw);
    keys(question, ["text", "metricIds"]);
    return { text: text(question.text, 400), metricIds: references(question.metricIds, allowed) };
  });
  return { sections, questions };
}

export const INSIGHTS_SCHEMA = {
  type: "object", additionalProperties: false, required: ["sections", "questions"],
  properties: {
    sections: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "narrative", "metricIds", "limitations"], properties: {
      id: { type: "string", enum: Object.keys(SECTION_TITLES) }, narrative: { type: "string" }, metricIds: { type: "array", items: { type: "string" } }, limitations: { type: "array", items: { type: "string" } },
    } } },
    questions: { type: "array", items: { type: "object", additionalProperties: false, required: ["text", "metricIds"], properties: { text: { type: "string" }, metricIds: { type: "array", items: { type: "string" } } } } },
  },
} as const;

export function validateSummary(summary: ValidatedFinancialSummary) {
  keys(object(summary), ["version", "source", "scope", "reportingPeriod", "currency", "dataVersion", "metrics", "limitations"]);
  keys(object(summary.scope), ["kind", "investorCount"]);
  keys(object(summary.reportingPeriod), ["current", "previous"]);
  if (!Array.isArray(summary.metrics) || !Array.isArray(summary.limitations) || summary.limitations.length > 12 || !/^[a-zA-Z0-9._:-]{1,128}$/.test(summary.dataVersion) || Object.values(summary.reportingPeriod).some(period => typeof period !== "string" || !/^[A-Za-z]{3} \d{1,2}, \d{4}$/.test(period))) throw new InsightsError("INVALID_SUMMARY");
  summary.limitations.forEach(limitation => text(limitation, 400));
  if (summary.version !== "1" || !["synthetic-demo", "trusted-server"].includes(summary.source) || !["individual", "consolidated"].includes(summary.scope.kind) || !Number.isSafeInteger(summary.scope.investorCount) || summary.scope.investorCount < 1 || (summary.scope.kind === "individual" && summary.scope.investorCount !== 1) || !/^[A-Z]{3}$/.test(summary.currency) || !summary.dataVersion || summary.metrics.length > 160) throw new InsightsError("INVALID_SUMMARY");
  const ids = new Set<string>();
  for (const metric of summary.metrics) {
    keys(object(metric), ["id", "label", "value", "unit"]);
    text(metric.label, 120);
    if (!/^[a-z][a-z0-9.-]{0,80}$/.test(metric.id) || ids.has(metric.id) || (metric.value !== null && (!Number.isFinite(metric.value) || Math.abs(metric.value) > 1e15)) || !["currency", "percent", "count"].includes(metric.unit)) throw new InsightsError("INVALID_SUMMARY");
    ids.add(metric.id);
  }
  const amount = (id: string) => summary.metrics.find(metric => metric.id === id)?.value;
  for (const period of ["current", "previous"]) {
    const assets = amount(`assets.${period}`), liabilities = amount(`liabilities.${period}`), netWorth = amount(`net-worth.${period}`);
    if (assets === undefined || liabilities === undefined || netWorth === undefined || (assets !== null && liabilities !== null && netWorth !== null && Math.abs(assets - liabilities - netWorth) > .005)) throw new InsightsError("INVALID_SUMMARY");
  }
  return summary;
}
