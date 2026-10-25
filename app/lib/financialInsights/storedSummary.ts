import { validateNormalizedReport } from "../backend/normalized";
import type { NormalizedReport } from "../backend/normalizedTypes";
import { deriveSelectedInvestorReport } from "../reportData";
import type { ParsedRow } from "../documentParser";
import { financialSummary } from "./summary";
import { InsightsError, validateSummary } from "./contracts";
export function summaryFromNormalized(
  input: NormalizedReport,
  references: string[],
  requestId: string,
) {
  const normalized = validateNormalizedReport(input);
  if (
    !references.length ||
    new Set(references).size !== references.length ||
    references.some(
      (ref) =>
        !normalized.investors.some(
          (investor) => investor.localReference === ref,
        ),
    )
  )
    throw new InsightsError("REPORT_UNAUTHORIZED", 403);
  const selected = normalized.investors.filter((investor) =>
    references.includes(investor.localReference),
  );
  const rows: ParsedRow[] = selected.flatMap((investor) =>
    investor.categories.map((category, index) => ({
      id: `${investor.localReference}-${index}`,
      investorId: investor.localReference,
      investor: investor.localReference,
      statementId: investor.localReference,
      include: true,
      isLeafAccount: true,
      description: category.category,
      category: category.category,
      kind: category.kind,
      current: category.current,
      rawCurrent: category.current,
      previous: category.previous,
      rawPrevious: category.previous,
      ownershipPercentage: 100,
      source: "",
      holder: "",
      institution: "",
      accountName: "",
    })),
  );
  const report = deriveSelectedInvestorReport(
    rows,
    selected.map((investor) => ({
      investorId: investor.localReference,
      name: investor.localReference,
    })),
    references,
  );
  const summary = financialSummary(report, {
    date: normalized.currentPeriod,
    currency: normalized.currency,
    currencies: [normalized.currency],
    dataVersion: requestId,
    source: "trusted-server",
  });
  const counts = selected.flatMap((investor) => investor.categories);
  summary.metrics.find(
    (metric) => metric.id === "data.included-accounts",
  )!.value = counts.reduce((sum, category) => sum + category.accountCount, 0);
  summary.metrics.find(
    (metric) => metric.id === "data.missing-previous",
  )!.value = counts.reduce(
    (sum, category) => sum + category.missingPreviousCount,
    0,
  );
  summary.metrics.push(
    {
      id: "data.excluded-rows",
      label: "Excluded rows",
      value: selected.reduce(
        (sum, investor) => sum + investor.excludedRowCount,
        0,
      ),
      unit: "count",
    },
    {
      id: "data.low-confidence",
      label: "Low confidence records",
      value: counts.reduce(
        (sum, category) => sum + category.lowConfidenceCount,
        0,
      ),
      unit: "count",
    },
    {
      id: "data.missing-current",
      label: "Accounts without current values",
      value: 0,
      unit: "count",
    },
  );
  if (counts.some((category) => category.lowConfidenceCount))
    summary.limitations.push(
      "Some confirmed records have low source confidence; supporting records should be reviewed before financial decisions.",
    );
  return validateSummary(summary);
}
