import type { InvestorStatement, InvestorStatementPrintRow } from "./reportData";

export function roundCurrency(value: number) {
  return Math.round((value + Math.sign(value) * Number.EPSILON * Math.max(1, Math.abs(value))) * 100) / 100;
}

export function formatStatementAmount(value: number, currency: string) {
  const amount = value;
  try {
    return new Intl.NumberFormat("en-CA", {style:"currency",currency,currencyDisplay:"narrowSymbol",currencySign:"accounting",minimumFractionDigits:0,maximumFractionDigits:0}).format(amount);
  } catch {
    return amount.toLocaleString("en-CA", {minimumFractionDigits:0,maximumFractionDigits:0});
  }
}

/** Round each displayed share once; every printed subtotal sums those same cents.
 * This presentation copy never changes reconciliation, raw rows, or CSV data. */
export function statementPresentation(source: InvestorStatement): InvestorStatement {
  const sum = (values: number[]) => roundCurrency(values.reduce((total, value) => total + value, 0));
  const sections = source.sections.map(section => {
    const categories = section.categories.map(category => {
      const accounts = category.accounts.map(account => ({
        ...account,
        currentShare: roundCurrency(account.currentFull * account.ownership / 100),
        previousShare: roundCurrency(account.previousFull * account.ownership / 100),
      })).sort((left, right) => left.holder.localeCompare(right.holder));
      return { ...category, accounts,
        currentShare: sum(accounts.map(account => account.currentShare)),
        previousShare: sum(accounts.map(account => account.previousShare)),
      };
    });
    return { ...section, categories,
      currentShare: sum(categories.map(category => category.currentShare)),
      previousShare: sum(categories.map(category => category.previousShare)),
    };
  });
  const [assets, liabilities] = sections;
  return { ...source, sections,
    currentShareAssets: assets.currentShare, previousShareAssets: assets.previousShare,
    currentShareLiabilities: liabilities.currentShare, previousShareLiabilities: liabilities.previousShare,
    currentShareNetWorth: roundCurrency(assets.currentShare - liabilities.currentShare),
    previousShareNetWorth: roundCurrency(assets.previousShare - liabilities.previousShare),
  };
}

/** Minimize page count, then balance occupied heights. Measured row heights include
 * wrapped names and both ownership lines; headings stay with their first account,
 * and totals stay with the preceding account. No heading-only or totals-only pages. */
export function paginateMeasuredStatement(rows: InvestorStatementPrintRow[], heights: number[], capacity: number) {
  if (rows.length !== heights.length || heights.some(height => !Number.isFinite(height) || height <= 0) || capacity <= 0) {
    throw new Error("Invalid statement page measurements.");
  }
  if (!rows.length) return [];
  const costs = Array.from({length: rows.length + 1}, () => ({pages: Infinity, waste: Infinity, end: -1}));
  costs[rows.length] = {pages: 0, waste: 0, end: rows.length};
  for (let start = rows.length - 1; start >= 0; start--) {
    let height = 0;
    let hasAccount = false;
    for (let end = start + 1; end <= rows.length; end++) {
      height += heights[end - 1];
      if (height > capacity) break;
      hasAccount ||= rows[end - 1].level === "account";
      if (!hasAccount || ["section", "category"].includes(rows[end - 1].level)) continue;
      if (end < rows.length && ["subtotal", "sectionTotal", "netWorth"].includes(rows[end].level)) continue;
      const next = costs[end];
      const pages = next.pages + 1;
      const waste = next.waste + (capacity - height) ** 2;
      if (pages < costs[start].pages || (pages === costs[start].pages && waste < costs[start].waste)) {
        costs[start] = {pages, waste, end};
      }
    }
  }
  if (!Number.isFinite(costs[0].pages)) throw new Error("An account group exceeds the printable page height. Shorten its description before printing.");
  const pages: InvestorStatementPrintRow[][] = [];
  for (let start = 0; start < rows.length; start = costs[start].end) pages.push(rows.slice(start, costs[start].end));
  return pages;
}
