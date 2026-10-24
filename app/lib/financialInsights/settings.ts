export type AnalysisCapability = {
  mode: "disabled" | "mock" | "live";
  canAnalyzeFinancialPosition: boolean;
  reason: string;
  providerLabel?: string;
  retentionNotice?: string;
};
export function readAnalysisMode(
  environment: Record<string, string | undefined>,
): AnalysisCapability["mode"] | "invalid" {
  if (
    Object.keys(environment).some(
      (name) =>
        /^NEXT_PUBLIC_.*(?:OPENAI|AI_API|AI_SECRET|AI_TOKEN)/i.test(name) &&
        environment[name],
    )
  )
    return "invalid";
  const mode =
    environment.FINANCIAL_ANALYSIS_MODE ??
    (environment.NODE_ENV === "development" ? "mock" : "disabled");
  if (mode === "mock")
    return environment.NODE_ENV === "production" &&
      !(
        environment.VERCEL_ENV === "preview" &&
        environment.APP_DATA_ENV === "preview"
      )
      ? "invalid"
      : "mock";
  return mode === "live" || mode === "disabled" ? mode : "invalid";
}
