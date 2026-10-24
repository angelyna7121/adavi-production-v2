"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { snapshotForSaving } from "./lib/financialInsights/saveSummary";
import DemoInsights from "./financial-insights-demo";
import {
  SECTION_TITLES,
  validateSummary,
  validateInsights,
  type Metric,
} from "./lib/financialInsights/contracts";
import type { AnalysisCapability } from "./lib/financialInsights/settings";
import type { ParsedRow } from "./lib/documentParser";
import type { ReportInvestor } from "./lib/reportData";
import { trustedSummary } from "./lib/financialInsights/selection";
import { formatStatementAmount } from "./lib/statementPresentation";
import type { LiveAnalysisResult } from "./lib/financialInsights/server/live";
import {
  CONSENT_VERSION,
  EDUCATIONAL_NOTICE,
} from "./lib/financialInsights/notices";

export type InsightsSelection = {
  rows: ParsedRow[];
  investors: ReportInvestor[];
  selectedInvestorIds: string[];
  date: string;
  currency: string;
  reportVersionId?: string;
  preferredInvestorId?: string;
};
const safeError: Record<string, string> = {
  RATE_LIMITED: "Usage limit reached",
  USAGE_LIMIT_REACHED: "Usage limit reached",
  NOT_INCLUDED_IN_PLAN: "Not included in plan",
  DATA_REQUIRES_REVIEW: "Data requires review",
  RECONCILIATION_FAILED: "Data requires review",
  AUTHENTICATION_REQUIRED:
    "Sign in with a verified account to analyze this report.",
  REPORT_CHANGED: "The report changed. Review it before trying again.",
};
export default function FinancialInsightsPanel({
  capability,
  selection,
}: {
  capability: AnalysisCapability;
  selection: InsightsSelection;
}) {
  const [ids, setIds] = useState<string[]>(() =>
    selection.selectedInvestorIds.length === 1
      ? selection.selectedInvestorIds
      : selection.preferredInvestorId &&
          selection.selectedInvestorIds.includes(selection.preferredInvestorId)
        ? [selection.preferredInvestorId]
        : [],
  );
  const [consentOpen, setConsentOpen] = useState(false),
    [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [saved, setSaved] = useState<{
    reportVersionId: string;
    investorMap: Record<string, string>;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<LiveAnalysisResult | null>(null),
    [expanded, setExpanded] = useState(true);
  const dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    request = useRef<AbortController | null>(null);
  const preview = useMemo(() => {
    try {
      return {
        summary: trustedSummary(
          {
            accountId: "local-preview",
            versionId: "local-preview",
            revision: "local-preview",
            confirmed: true,
            rows: selection.rows,
            investors: selection.investors,
            authorizedInvestorIds: selection.selectedInvestorIds,
            date: selection.date,
            currency: selection.currency,
            currencies: [selection.currency],
          },
          ids,
          "local-preview",
        ),
        error: "",
      };
    } catch {
      return { summary: null, error: "Data requires review" };
    }
  }, [selection, ids]);
  useEffect(() => {
    if (consentOpen) dialog.current?.showModal();
    else dialog.current?.close();
  }, [consentOpen]);
  useEffect(() => () => request.current?.abort(), []);
  if (capability.mode === "mock")
    return (
      <DemoInsights
        initialScope={
          selection.selectedInvestorIds.length === 1
            ? "individual"
            : "consolidated"
        }
      />
    );
  const available =
    capability.canAnalyzeFinancialPosition &&
    !!(saved?.reportVersionId ?? selection.reportVersionId) &&
    !!preview.summary;
  const names = selection.investors
    .filter((investor) => ids.includes(investor.investorId))
    .map((investor) => investor.name)
    .join(", ");
  const metricValue = (metric: Metric) =>
    metric.value === null
      ? "Unavailable"
      : metric.unit === "currency"
        ? `${selection.currency} ${formatStatementAmount(metric.value, selection.currency)}`
        : `${metric.value.toLocaleString("en-CA", { maximumFractionDigits: 2 })}${metric.unit === "percent" ? "%" : ""}`;
  function closeConsent() {
    setConsentOpen(false);
    setAgreed(false);
    trigger.current?.focus();
  }
  async function analyze() {
    if (!agreed || request.current || !available) return;
    const controller = new AbortController();
    request.current = controller;
    closeConsent();
    setLoading(true);
    setError("");
    try {
      // IDs identify authorized server records. Names, rows and balances stay local.
      const response = await fetch("/api/financial-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          reportVersionId: saved?.reportVersionId ?? selection.reportVersionId,
          investorIds: ids.map((id) => saved?.investorMap[id] ?? id),
          consent: true,
          consentVersion: CONSENT_VERSION,
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          safeError[body.error?.code] ??
            "We could not generate the analysis. Your report and financial totals remain available.",
        );
      if (
        body.source !== "live" ||
        body.summary?.source !== "trusted-server" ||
        typeof body.requestId !== "string" ||
        typeof body.modelLabel !== "string" ||
        typeof body.generatedAt !== "string" ||
        !Number.isFinite(Date.parse(body.generatedAt))
      )
        throw new Error("The analysis response could not be verified.");
      validateSummary(body.summary);
      validateInsights(body.insights, body.summary);
      // Never render stale financial results against a different local report.
      if (
        JSON.stringify(
          body.summary.metrics.filter((metric: Metric) =>
            [
              "assets.current",
              "liabilities.current",
              "net-worth.current",
              "assets.previous",
              "liabilities.previous",
              "net-worth.previous",
              "data.included-accounts",
              "data.missing-previous",
            ].includes(metric.id),
          ),
        ) !==
          JSON.stringify(
            preview.summary?.metrics.filter((metric) =>
              [
                "assets.current",
                "liabilities.current",
                "net-worth.current",
                "assets.previous",
                "liabilities.previous",
                "net-worth.previous",
                "data.included-accounts",
                "data.missing-previous",
              ].includes(metric.id),
            ),
          ) ||
        JSON.stringify(body.summary.scope) !==
          JSON.stringify(preview.summary?.scope) ||
        body.summary.currency !== selection.currency ||
        JSON.stringify(body.summary.reportingPeriod) !==
          JSON.stringify(preview.summary?.reportingPeriod)
      )
        throw new Error(
          "The saved report differs from this report. Save and review the current version before analyzing.",
        );
      if (!controller.signal.aborted) {
        setResult(body);
        setExpanded(true);
      }
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(
          reason instanceof Error
            ? reason.message
            : "Service temporarily unavailable",
        );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  }
  async function save() {
    if (saving || loading || !preview.summary) return;
    setSaving(true);
    setError("");
    try {
      const snapshot = snapshotForSaving(
        selection.rows,
        selection.investors,
        ids,
        selection.date,
        selection.currency,
      );
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot.report),
      });
      const body = await response.json();
      if (
        !response.ok ||
        typeof body.reportVersionId !== "string" ||
        !body.investorMap
      )
        throw new Error(
          "Sign in with a verified account to save this financial summary.",
        );
      setSaved({
        reportVersionId: body.reportVersionId,
        investorMap: Object.fromEntries(
          Object.entries(snapshot.references).map(([id, reference]) => [
            id,
            body.investorMap[reference],
          ]),
        ),
      });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Saving is not yet available.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <section
      className="financialInsightsPanel printExcluded"
      aria-label="Financial position insights"
    >
      <fieldset
        disabled={loading || saving}
        className="analysisInvestorSelector"
      >
        <legend>Investors to analyze</legend>
        {selection.investors
          .filter((investor) =>
            selection.selectedInvestorIds.includes(investor.investorId),
          )
          .map((investor) => (
            <label key={investor.investorId}>
              <input
                type="checkbox"
                checked={ids.includes(investor.investorId)}
                onChange={(event) => {
                  setIds((current) =>
                    event.target.checked
                      ? [...current, investor.investorId]
                      : current.filter((id) => id !== investor.investorId),
                  );
                  setResult(null);
                  setSaved(null);
                  setError("");
                  setAgreed(false);
                }}
              />
              {investor.name}
            </label>
          ))}
      </fieldset>
      <p>
        {ids.length > 1
          ? "Consolidated analysis of the explicitly selected investors"
          : "Individual investor analysis"}
      </p>
      <p>
        {names || "Select an investor"} · {selection.date} ·{" "}
        {selection.currency}
      </p>
      {preview.summary && (
        <>
          <dl className="insightsMetricGrid">
            {preview.summary.metrics
              .filter((metric) =>
                [
                  "assets.current",
                  "liabilities.current",
                  "net-worth.current",
                  "data.included-accounts",
                  "data.missing-previous",
                  "data.review-flags",
                  "data.low-confidence",
                ].includes(metric.id),
              )
              .map((metric) => (
                <div key={metric.id}>
                  <dt>{metric.label}</dt>
                  <dd>{metricValue(metric)}</dd>
                </div>
              ))}
          </dl>
          <p>
            {preview.summary.limitations.find((limitation) =>
              limitation.startsWith("Previous-period"),
            )}
          </p>
        </>
      )}
      {capability.mode === "live" &&
        capability.canAnalyzeFinancialPosition &&
        !saved && (
          <>
            <p>
              Save only the anonymous category balances, ownership-adjusted
              totals, periods and quality indicators to your signed-in account.
              Documents, names, filenames and OCR text stay in this browser.
            </p>
            <button
              className="insightsTextButton"
              disabled={saving || loading || !preview.summary}
              onClick={save}
            >
              {saving
                ? "Saving summary…"
                : "Save financial summary for analysis"}
            </button>
          </>
        )}
      <button
        ref={trigger}
        type="button"
        className="analyzeFinancialButton"
        disabled={loading || !available}
        onClick={() => {
          setAgreed(false);
          setConsentOpen(true);
        }}
      >
        ✨ Analyze My Financial Position
      </button>
      <p role="status" aria-live="polite">
        {loading
          ? "Analyzing"
          : consentOpen
            ? "Awaiting consent"
            : error ||
              preview.error ||
              (result
                ? "Analysis complete"
                : available
                  ? "Ready to analyze"
                  : capability.reason)}
      </p>
      {!saved && !selection.reportVersionId && capability.mode === "live" && (
        <p>A verified, saved report is required before analysis.</p>
      )}
      {result && (
        <div className="insightsResult">
          <div className="insightsResultHeading">
            <h2>Financial Position Insights</h2>
            <button
              type="button"
              className="insightsTextButton"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Collapse analysis" : "Reopen analysis"}
            </button>
          </div>
          {expanded && (
            <>
              <p>
                Generated from the selected investor’s reconciled and
                ownership-adjusted financial summary.
              </p>
              <p>
                {names} · {result.summary.reportingPeriod.current} ·{" "}
                {selection.currency}
              </p>
              <p>
                Generated {new Date(result.generatedAt).toLocaleString("en-CA")}{" "}
                · {result.modelLabel}
              </p>
              {result.insights.sections.map((section, index) => (
                <details
                  key={section.id}
                  className="insightSection"
                  open={index === 0}
                >
                  <summary>{SECTION_TITLES[section.id]}</summary>
                  <p>
                    <strong>Educational observation:</strong>{" "}
                    {section.narrative}
                  </p>
                  <dl className="insightEvidence">
                    {section.metricIds.map((id) => {
                      const metric = result.summary.metrics.find(
                        (item) => item.id === id,
                      )!;
                      return (
                        <div key={id}>
                          <dt>Verified calculation · {metric.label}</dt>
                          <dd>{metricValue(metric)}</dd>
                        </div>
                      );
                    })}
                  </dl>
                  {section.limitations.map((limitation) => (
                    <p key={limitation}>{limitation}</p>
                  ))}
                </details>
              ))}
              <h3>Questions to Consider</h3>
              <ul>
                {result.insights.questions.map((question) => (
                  <li key={question.text}>{question.text}</li>
                ))}
              </ul>
              <h3>Data Limitations</h3>
              <ul>
                {result.summary.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <p className="insightsDisclosure">{EDUCATIONAL_NOTICE}</p>
      <dialog
        ref={dialog}
        className="insightsConsentDialog"
        aria-labelledby="analysis-consent-title"
        onCancel={(event) => {
          event.preventDefault();
          closeConsent();
        }}
        onClose={() => setConsentOpen(false)}
      >
        <h2 id="analysis-consent-title">
          Analyze the selected financial position
        </h2>
        <p>
          ADAVI will securely send an anonymous summary of the selected
          financial position to our AI provider to generate educational
          insights. Names, addresses, account numbers, filenames and uploaded
          statements will not be shared.
        </p>
        <p>
          {names} · {selection.date} · {selection.currency}
        </p>
        <h3>Information included</h3>
        <p>
          Reporting periods; currency; ownership-adjusted totals; category
          balances; financial ratios; data-completeness indicators.
        </p>
        <h3>Information excluded</h3>
        <p>
          Names and contact information; account numbers; uploaded documents;
          filenames; raw OCR text.
        </p>
        <p>
          Provider: {capability.providerLabel}. {capability.retentionNotice}
        </p>
        <p>
          Only a verified included usage allowance can be used. This action does
          not purchase an analysis.
        </p>
        <label className="insightsConsentChoice">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(event) => setAgreed(event.target.checked)}
          />
          I consent to the anonymous financial summary being processed to
          generate this analysis.
        </label>
        <div className="insightsConsentActions">
          <button
            type="button"
            className="insightsTextButton"
            onClick={closeConsent}
          >
            Cancel
          </button>
          <button
            type="button"
            className="analyzeFinancialButton"
            disabled={!agreed || loading}
            onClick={analyze}
          >
            {ids.length > 1
              ? "Analyze selected investors"
              : "Analyze selected investor"}
          </button>
        </div>
      </dialog>
    </section>
  );
}
