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
import {
  analysisEligibility,
  eligibility as eligibilityState,
  analysisRequestFailure,
  serviceEligibility,
  inspectAnalysisData,
  formatAnalysisDate,
} from "./lib/financialInsights/eligibility";
import { trustedSummary } from "./lib/financialInsights/selection";
import { formatStatementAmount } from "./lib/statementPresentation";
import type { LiveAnalysisResult } from "./lib/financialInsights/server/live";
import { CONSENT_VERSION } from "./lib/financialInsights/notices";

export type InsightsSelection = {
  rows: ParsedRow[];
  investors: ReportInvestor[];
  selectedInvestorIds: string[];
  date: string;
  currency: string;
  reportVersionId?: string;
  preferredInvestorId?: string;
};
export default function FinancialInsightsPanel({
  capability,
  selection,
  onSelectionChange,
  onReviewRows,
}: {
  capability: AnalysisCapability;
  selection: InsightsSelection;
  onSelectionChange: (ids: string[]) => void;
  onReviewRows: (ids: string[]) => void;
}) {
  const ids = selection.selectedInvestorIds;
  const [consentOpen, setConsentOpen] = useState(false),
    [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [saved, setSaved] = useState<{
    reportVersionId: string;
    investorMap: Record<string, string>;
  } | null>(null);
  const [requestFailure, setRequestFailure] = useState<ReturnType<
    typeof analysisRequestFailure
  > | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<LiveAnalysisResult | null>(null),
    [expanded, setExpanded] = useState(true);
  const dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    request = useRef<AbortController | null>(null);
  const data = useMemo(
    () => inspectAnalysisData({ ...selection }),
    [selection],
  );
  const service = serviceEligibility(capability);
  const preview = useMemo(() => {
    if (!data.eligibility.eligible) return { summary: null, error: "" };
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
      return {
        summary: null,
        error:
          "Financial analysis is temporarily unavailable. Please try again later.",
      };
    }
  }, [selection, ids, data.eligibility.eligible]);
  const status =
    requestFailure && service.eligible
      ? requestFailure.eligibility
      : analysisEligibility(
          preview.error
            ? eligibilityState("configuration-error", preview.error)
            : data.eligibility,
          capability,
        );
  useEffect(() => {
    if (consentOpen) dialog.current?.showModal();
    else dialog.current?.close();
  }, [consentOpen]);
  useEffect(() => () => request.current?.abort(), []);
  const available =
    status.eligible &&
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
    let failure: ReturnType<typeof analysisRequestFailure> | null = null;
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
      if (!response.ok) {
        if (
          [
            "REPORT_CHANGED",
            "DATA_REQUIRES_REVIEW",
            "RECONCILIATION_FAILED",
          ].includes(body.error?.code)
        )
          setSaved(null);
        failure = analysisRequestFailure(body.error?.code);
        setRequestFailure(failure);
        throw new Error(failure.eligibility.message);
      }
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
    } catch {
      if (!controller.signal.aborted) {
        const safe = failure ?? analysisRequestFailure("TEMPORARY_FAILURE");
        setRequestFailure(safe);
        setError(safe.eligibility.message);
      }
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
    } catch {
      setError(
        "The summary could not be saved. Sign in with a verified account or try again later.",
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
      <div className="analysisHeading">
        <div>
          <h2 id="financial-analysis-heading" tabIndex={-1}>
            Financial Position Analysis
          </h2>
          <p>
            Review the selected financial position and request educational
            insights when available.
          </p>
        </div>
      </div>
      <fieldset
        disabled={loading || saving}
        className="analysisInvestorSelector"
      >
        <legend>Investors to analyze</legend>
        {selection.investors
          .filter((investor) => investor.name.trim())
          .map((investor) => (
            <label key={investor.investorId}>
              <input
                type="checkbox"
                data-analysis-investor-id={investor.investorId}
                checked={ids.includes(investor.investorId)}
                onChange={(event) => {
                  onSelectionChange(
                    event.target.checked
                      ? [...ids, investor.investorId]
                      : ids.filter((id) => id !== investor.investorId),
                  );
                  // The scope key deliberately clears stale results and consent.
                  // Restore keyboard focus after the newly scoped panel mounts.
                  requestAnimationFrame(() =>
                    Array.from(
                      document.querySelectorAll<HTMLInputElement>(
                        "[data-analysis-investor-id]",
                      ),
                    )
                      .find(
                        (input) =>
                          input.dataset.analysisInvestorId ===
                          investor.investorId,
                      )
                      ?.focus(),
                  );
                }}
              />
              {investor.name}
            </label>
          ))}
      </fieldset>
      <p className="analysisScopeLabel">
        {ids.length > 1
          ? "Combined investor analysis"
          : "Individual investor analysis"}
      </p>
      <p className="analysisIdentity">
        {ids.length > 1
          ? `${ids.length} investors`
          : names || "No investor selected"}{" "}
        · {formatAnalysisDate(selection.date)} · {selection.currency}
      </p>
      {data.report.hasSelection && (
        <>
          <dl
            className="insightsMetricGrid"
            aria-label="Confirmed selected financial totals"
          >
            {[
              {
                label: "Total assets",
                value: data.report.statement.currentShareAssets,
              },
              {
                label: "Total liabilities",
                value: data.report.statement.currentShareLiabilities,
              },
              {
                label: "Net worth",
                value: data.report.statement.currentShareNetWorth,
              },
            ].map((metric) => (
              <div key={metric.label}>
                <dt>{metric.label}</dt>
                <dd>
                  {selection.currency}{" "}
                  {formatStatementAmount(metric.value, selection.currency)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="analysisCoverage">
            {data.report.rows.length} confirmed included account
            {data.report.rows.length === 1 ? "" : "s"}
            {data.eligibility.affectedRowCount > 0
              ? ` · ${data.eligibility.affectedRowCount} rows awaiting review are excluded from these confirmed totals.`
              : ""}
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
        id="analysis-trigger"
        ref={trigger}
        type="button"
        className="analyzeFinancialButton"
        disabled={loading || !available}
        aria-describedby="financial-analysis-status"
        onClick={() => {
          setAgreed(false);
          setConsentOpen(true);
        }}
      >
        ✨ Analyze My Financial Position
      </button>
      <div
        id="financial-analysis-status"
        className={`analysisStatus ${!service.eligible ? "analysisStatusUnavailable" : ""}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <strong>
          {loading
            ? "Analyzing"
            : consentOpen
              ? "Awaiting consent"
              : result
                ? "Analysis complete"
                : !service.eligible
                  ? service.message
                  : status.eligible
                    ? saved
                      ? "Ready to analyze"
                      : "Save the confirmed summary to continue."
                    : status.message}
        </strong>
        {status.reason === "not-authorized" && (
          <a className="analysisStatusAction" href="/account">
            Sign in or view your plan
          </a>
        )}
      </div>
      {data.eligibility.affectedRowCount > 0 && (
        <div
          className="analysisReviewWarning"
          role="region"
          aria-label="Review required before analysis"
        >
          <h3>Review required before analysis</h3>
          <p>
            {data.eligibility.affectedRowCount} included row
            {data.eligibility.affectedRowCount === 1
              ? " contains"
              : "s contain"}{" "}
            low-confidence or unreconciled values. Confirm or exclude these rows
            before requesting financial analysis.
          </p>
          <ul>
            {[
              ...new Set(
                data.issues
                  .filter((issue) => issue.rowIds.length)
                  .map((issue) => issue.message),
              ),
            ].map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
          <details className="analysisAffectedRows">
            <summary>See affected rows</summary>
            <ul>
              {data.eligibility.affectedRowIds.map((id) => {
                const row = selection.rows.find((row) => row.id === id);
                return (
                  <li key={id}>{row?.description.trim() || "Account row"}</li>
                );
              })}
            </ul>
          </details>
          <button
            type="button"
            className="insightsTextButton"
            onClick={() => onReviewRows(data.eligibility.affectedRowIds)}
          >
            Review {data.eligibility.affectedRowCount} flagged row
            {data.eligibility.affectedRowCount === 1 ? "" : "s"}
          </button>
        </div>
      )}
      {!data.eligibility.eligible && !data.eligibility.affectedRowCount && (
        <p className="analysisDataStatus" role="status">
          {data.eligibility.message}
        </p>
      )}
      {requestFailure?.eligibility.reason === "unreconciled-values" && (
        <button
          type="button"
          className="insightsTextButton"
          onClick={() => onReviewRows(data.report.rows.map((row) => row.id))}
        >
          Review selected rows
        </button>
      )}
      {(error || preview.error) && (
        <div className="insightsError" role="alert">
          <p>{error || preview.error}</p>
          {service.eligible &&
            data.eligibility.eligible &&
            requestFailure?.retryable && (
              <button
                className="insightsTextButton"
                type="button"
                onClick={() => {
                  setError("");
                  setRequestFailure(null);
                  setAgreed(false);
                  setConsentOpen(true);
                }}
              >
                Try again
              </button>
            )}
        </div>
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
                {ids.length > 1 ? `${ids.length} investors` : names} ·{" "}
                {result.summary.reportingPeriod.current} · {selection.currency}
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
      <p className="insightsDisclosure analysisDisclaimer">
        ADAVI provides educational financial information based on the data you
        confirm. It is not investment, tax, legal or accounting advice.
      </p>
      {capability.mode === "mock" && (
        <details className="analysisDemo">
          <summary>Open labelled synthetic demonstration</summary>
          <DemoInsights
            initialScope={ids.length > 1 ? "consolidated" : "individual"}
          />
        </details>
      )}
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
          {ids.length > 1 ? `${ids.length} investors` : names} ·{" "}
          {formatAnalysisDate(selection.date)} · {selection.currency}
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
          I understand that the confirmed financial values for the selected
          investor(s) will be sent securely to the authorized AI provider to
          generate educational information.
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
