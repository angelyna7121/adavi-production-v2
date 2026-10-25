export const woodGundyExpectedAccounts = [
  ["451004771C", "Non-registered / Cash", 1_209_488],
  ["45100480", "Non-registered / Cash", 1_451_153],
  ["551193301C", "Spousal RRSP", 61_867],
  ["551193311C", "Spousal RRSP", 94_228],
  ["551193321C", "RRSP", 753_303],
  ["551193331C", "RRSP", 451_063],
  ["693455401C", "TFSA", 192_011],
] as const;

export const woodGundyPortfolioPages = [
  { pageNumber:1, text:`CIBC Private Wealth Wood Gundy
Portfolio Evaluation
Investor: Sample Investor
Account Number: 451004771C
Cash
Cash Balance 18,250
Common Shares 930,000
Total Equity 930,000
Book Value 1,100,000
Total Portfolio Value $1,209,488` },
  { pageNumber:2, text:`CIBC Private Wealth Wood Gundy
Portfolio Evaluation
Investor: Sample Investor
Account Number: 45100480
Cash
Account Details
451004801C CAD subaccount
451004801U USD subaccount
Total Cash & Cash Equivalents 75,000
Total Fixed Income 600,000
Total Portfolio Value 1,451,153` },
  { pageNumber:3, text:`CIBC Private Wealth Wood Gundy
Portfolio Evaluation
Investor: Sample Investor
Account Number: 551193301C
Spousal RRSP
ABC Fund 55,000
Total Portfolio Value $61,867
Account Number: 551193311C
Spousal RRSP
Preferred Shares 80,000
Total Portfolio Value $94,228` },
  { pageNumber:4, text:`CIBC Private Wealth Wood Gundy
Portfolio Evaluation
Investor: Sample Investor
Account Number: 551193321C
Registered Retirement Savings Plan
Structured Note 700,000
Market Value subtotal 745,000
Total Portfolio Value $753,303` },
  { pageNumber:5, text:`CIBC Private Wealth Wood Gundy
Portfolio Evaluation
Investor: Sample Investor
Account Number: 551193331C
Registered Retirement Savings Plan
Corporate Bond 400,000
Total Fixed Income 400,000` },
  { pageNumber:6, text:`CIBC Private Wealth Wood Gundy
Portfolio Evaluation
Accrued Interest 1,063
Declared and Unpaid Dividends 0
Total Portfolio Value
$451,063` },
  { pageNumber:7, text:`CIBC Private Wealth Wood Gundy
Portfolio Evaluation
Investor: Sample Investor
Account Number: 693455401C
Tax-Free Savings Account
Exchange Traded Fund 180,000
Annual Income 4,000
Total Portfolio Value $192,011` },
];
