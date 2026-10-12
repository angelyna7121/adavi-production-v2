export type SuffolkControl = {
  category: string;
  current: number;
  previous: number;
};

export const suffolkAssetControls: SuffolkControl[] = [
  { category: "Real Estate", current: 300_000, previous: 300_000 },
  {
    // Source category subtotal. The two displayed leaf values contain
    // a $1 source inconsistency, which must be reported by reconciliation.
    category: "Investments", current: 3_969_755, previous: 3_969_755,
  },
  { category: "Loans Receivable", current: 3_781_300, previous: 3_781_300 },
  {
    // Source category subtotal. Displayed leaves differ by $1.
    category: "Mortgage Investments / Mortgage Receivables", current: 7_641_069, previous: 7_371_085,
  },
  { category: "Corporate Tax Instalment Receivable", current: 983_727, previous: 914_386 },
  { category: "CIBC Bank", current: 1_347_353, previous: 623_646 },
  { category: "CIBC Bank-Suffolk LP", current: 2_520_363, previous: 3_514_156 },
  { category: "Suffolk LP Receivable", current: 3_200_000, previous: 2_200_000 },
];

export const suffolkLiabilityControls: SuffolkControl[] = [
  { category: "Corporate Tax Payable", current: 983_727, previous: 914_386 },
  { category: "Fleet Street Financial Corp. Loan", current: 2_280_517, previous: 2_280_517 },
  { category: "Ariana Ferrer Loan", current: 10_000, previous: 10_000 },
  { category: "Suffolk LP Loan", current: 3_200_000, previous: 2_200_000 },
  { category: "Shareholder Advance - Jay Borkowsky", current: 950_000, previous: 950_000 },
];

export function sumPeriod(rows: SuffolkControl[], period: "current" | "previous"): number {
  return rows.reduce((total, row) => total + row[period], 0);
}

export const expectedSuffolkTotals = {
  current: { assets: sumPeriod(suffolkAssetControls, "current"), liabilities: sumPeriod(suffolkLiabilityControls, "current") },
  previous: { assets: sumPeriod(suffolkAssetControls, "previous"), liabilities: sumPeriod(suffolkLiabilityControls, "previous") },
};

export const expectedSuffolkNetWorth = {
  current: expectedSuffolkTotals.current.assets - expectedSuffolkTotals.current.liabilities,
  previous: expectedSuffolkTotals.previous.assets - expectedSuffolkTotals.previous.liabilities,
};

export const expectedSuffolkChange = expectedSuffolkNetWorth.current - expectedSuffolkNetWorth.previous;

export const suffolkMortgageLeaves = [
  ["9390 Woodbine Ave (Am-stat)", 1_071_625, 1_051_641],
  ["MSR Lalu Jackson's Point", 500_000, 500_000],
  ["Brockville Limited Partnership", 300_000, 300_000],
  ["136 Markland Street (1st)", 150_000, 150_000],
  ["136 Markland Street (2nd)", 225_000, 225_000],
  ["5250 Yonge Street (Sky Mortgage)", 500_000, 500_000],
  ["3573 Riva Avenue (Jorlee)", 550_000, 550_000],
  ["98 Dunlop St", 375_000, 375_000],
  ["6 Chipstead (JHL)", 500_000, 500_000],
  ["21 Fairfield Dr (JHL)", 666_667, 666_667],
  ["32 Larabee Cres (JHL)", 500_000, 500_000],
  ["118 Avondale (JHL)", 300_000, 300_000],
  ["104 Frankdale (JHL)", 400_000, 400_000],
  ["51 Red Deer (JHL)", 375_000, 375_000],
  ["125 Pleasant Avenue (JHL)", 266_667, 266_667],
  ["111 Crescent Cres (JHL)", 144_444, 144_444],
  ["144 Old Orchard (JHL)", 500_000, 500_000],
  ["56 Ladylipper (JHL)", 66_667, 66_667],
  // The source prints a dash, which represents a zero previous balance.
  ["669 Cosburn Ave (JHL)", 250_000, 0],
] as const;
