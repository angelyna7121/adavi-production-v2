"use client";

import { useEffect, useRef, useState } from "react";
import { DISCLOSURE, SECTION_TITLES, validateInsights, validateSummary, type AnalysisResult, type DemoScope, type Metric } from "./lib/financialInsights/contracts";
import { formatStatementAmount } from "./lib/statementPresentation";

const errors: Record<string, string> = {
  RATE_LIMITED: "The demonstration request limit has been reached. Please try again in a minute.",
  DEMO_ALLOWANCE_EXHAUSTED: "This demonstration session has used its allowance. Reopen a completed result without another request.",
  LIVE_AUTHORIZATION_UNAVAILABLE: "Customer analysis is unavailable until secure account access and usage allowances are implemented.",
  SERVICE_BUSY: "The demonstration service is busy. Please try again shortly.",
};

function metricValue(metric: Metric, currency: string) {
  if (metric.value === null) return "Unavailable";
  if (metric.unit === "currency") return formatStatementAmount(metric.value, currency);
  return `${metric.value.toLocaleString("en-CA", { maximumFractionDigits: 0 })}${metric.unit === "percent" ? "%" : ""}`;
}

export default function FinancialInsightsPanel({ initialScope }: { initialScope: DemoScope }) {
  const [scope, setScope] = useState<DemoScope>(initialScope);
  const [consentOpen, setConsentOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(true);
  const [cache, setCache] = useState<Partial<Record<DemoScope, AnalysisResult>>>({});
  const request = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const result = cache[scope];

  useEffect(() => {
    if (consentOpen && !dialog.current?.open) dialog.current?.showModal();
    if (!consentOpen && dialog.current?.open) dialog.current.close();
  }, [consentOpen]);
  useEffect(() => () => request.current?.abort(), []);

  function closeConsent() { setConsentOpen(false); setAgreed(false); trigger.current?.focus(); }
  function openAnalysis() {
    setError("");
    if (result) { setExpanded(true); return; }
    setAgreed(false); setConsentOpen(true);
  }
  async function analyze() {
    if (!agreed || request.current) return;
    const controller = new AbortController(); request.current = controller;
    closeConsent(); setLoading(true); setError("");
    try {
      // Only a public fixture choice crosses this boundary. Customer names,
      // investor IDs, dates, totals, rows and documents never leave the browser.
      const response = await fetch("/api/financial-insights", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "demo", scope, consent: true }), signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(errors[body.error?.code] ?? "The demonstration could not be completed. Please retry when the service is available.");
      if (body.source !== "demonstration" || body.summary?.source !== "synthetic-demo" || body.summary?.scope?.kind !== scope || body.usage?.inputTokens !== 0 || body.usage?.outputTokens !== 0 || body.usage?.estimatedCostUsd !== 0) throw new Error("The service returned an unexpected result. Nothing has been added to your report.");
      validateSummary(body.summary); validateInsights(body.insights, body.summary);
      if (!controller.signal.aborted) { setCache(current => ({ ...current, [scope]: body as AnalysisResult })); setExpanded(true); }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "The demonstration service is unavailable.");
    } finally {
      if (request.current === controller) { request.current = null; setLoading(false); }
    }
  }

  return <section className="financialInsightsPanel printExcluded" aria-label="Optional financial insights">
    <button ref={trigger} type="button" className="analyzeFinancialButton" disabled={loading} onClick={openAnalysis}>✨ Analyze My Financial Position</button>
    <p className="insightsAvailability">Live customer analysis is unavailable. Explore a synthetic demonstration with no external AI request and no charge.</p>
    <label className="demoScopeSelector">Demonstration scope<select value={scope} disabled={loading} onChange={event => { setScope(event.target.value as DemoScope); setError(""); setExpanded(true); }}><option value="individual">Individual synthetic investor</option><option value="consolidated">Consolidated synthetic investors</option></select></label>
    <div role="status" aria-live="polite">{loading && <p>Preparing synthetic demonstration… <button type="button" className="insightsTextButton" onClick={() => { request.current?.abort(); request.current = null; setLoading(false); }}>Cancel</button></p>}</div>
    {error && <div className="insightsError" role="alert"><p>{error}</p><button type="button" className="insightsTextButton" onClick={openAnalysis}>Retry demonstration</button></div>}
    {result && <div className="insightsResult">
      <div className="insightsResultHeading"><h2>ADAVI AI Financial Insights</h2><button type="button" className="insightsTextButton" aria-expanded={expanded} aria-controls="financial-insights-content" onClick={() => setExpanded(value => !value)}>{expanded ? "Collapse analysis" : "Reopen analysis"}</button></div>
      <p className="demoLabel">Demonstration — synthetic data and handwritten commentary. This is not a real AI-generated analysis of your financial position.</p>
      {expanded && <div id="financial-insights-content">
        <p>{result.summary.scope.kind === "individual" ? "Individual synthetic investor" : "Consolidated synthetic investors"} · {result.summary.reportingPeriod.current} · {result.summary.currency}</p>
        <dl className="insightsMetricGrid">{result.summary.metrics.filter(metric => ["assets.current", "liabilities.current", "net-worth.current"].includes(metric.id)).map(metric => <div key={metric.id}><dt>{metric.label}</dt><dd>{metricValue(metric, result.summary.currency)}</dd></div>)}</dl>
        {result.insights.sections.map((section, index) => <details key={section.id} className="insightSection" open={index === 0}><summary>{SECTION_TITLES[section.id]}</summary><p>{section.narrative}</p><dl className="insightEvidence">{section.metricIds.map(id => { const metric = result.summary.metrics.find(item => item.id === id)!; return <div key={id}><dt>{metric.label}</dt><dd>{metricValue(metric, result.summary.currency)}</dd></div>; })}</dl>{section.limitations.map(limitation => <p className="insightLimitation" key={limitation}>{limitation}</p>)}</details>)}
        <h3>Review questions</h3><ul className="insightsQuestions">{result.insights.questions.map(question => <li key={question.text}>{question.text}</li>)}</ul>
        <h3>Data coverage</h3><ul className="insightsQuestions">{result.summary.limitations.map(limitation => <li key={limitation}>{limitation}</li>)}</ul>
        <p className="insightsDisclosure"><strong>Disclosure for future live AI analysis</strong><br/>{DISCLOSURE}</p>
        <p className="insightsUsage">Demonstration requests use no AI tokens and incur no provider charge. {result.cached ? "Reused the completed server result." : "Reopening this result makes no additional request."} Results are temporary and are excluded from the printable statement.</p>
      </div>}
    </div>}
    <dialog ref={dialog} className="insightsConsentDialog" aria-labelledby="insights-consent-title" onCancel={event => { event.preventDefault(); closeConsent(); }} onClose={() => setConsentOpen(false)} onKeyDown={event => {
      if (event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]'));
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <h2 id="insights-consent-title">Consent to financial analysis</h2>
      <p><strong>This run is a synthetic demonstration.</strong> Your uploaded files, financial values, investor identities and reporting dates are not transmitted. Only the synthetic scope selection and your consent are sent to ADAVI.</p>
      <p>Future live analysis would send a minimal financial summary to OpenAI: authorized scope, reporting periods, currency, ownership-adjusted totals, ratios, category balances and completeness indicators. It would exclude customer names, addresses, account numbers and raw documents.</p>
      <p>Live processing is disabled pending authenticated access, verified server records, privacy review and approved usage allowances. API retention and data residency depend on the provider configuration; this demonstration makes no claim of zero retention or Canadian residency.</p>
      <p><strong>No charge applies to this demonstration.</strong> It allows individual and consolidated examples with bounded request limits. Future AI usage limits and any charges must be disclosed and approved separately.</p>
      <label className="insightsConsentChoice"><input type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)}/>I agree to run the synthetic demonstration only.</label>
      <div className="insightsConsentActions"><button type="button" className="insightsTextButton" onClick={closeConsent}>Cancel</button><button type="button" className="analyzeFinancialButton" disabled={!agreed} onClick={analyze}>Run demonstration</button></div>
    </dialog>
  </section>;
}
