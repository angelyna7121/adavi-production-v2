export const categories = {
  Asset: [
    "Real Estate",
    "Investments",
    "Loans Receivable",
    "Mortgage Investments / Mortgage Receivables",
    "Corporate Tax Instalment Receivable",
    "Cash & Bank Accounts",
    "Other Receivables",
    "Vehicles",
    "Insurance Cash Value",
    "Inherited Assets",
    "Other Assets",
  ],
  Liability: [
    "Corporate Tax Payable",
    "Loans Payable",
    "Shareholder Advances",
    "Mortgages Payable",
    "Taxes Owing",
    "Accounts Payable",
    "Credit Cards",
    "Other Liabilities",
  ],
} as const;
export type NormalizedCategory = {
  category: string;
  kind: "Asset" | "Liability";
  current: number;
  previous: number | null;
  accountCount: number;
  missingPreviousCount: number;
  lowConfidenceCount: number;
};
export type NormalizedReport = {
  version: "1";
  currency: string;
  currentPeriod: string;
  previousPeriod: string;
  confirmed: true;
  investors: {
    localReference: string;
    categories: NormalizedCategory[];
    excludedRowCount: number;
  }[];
};
