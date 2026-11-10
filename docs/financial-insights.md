# Financial position insights

The production interface previews the actual report's selected financial position. Production analysis defaults to disabled; a disabled service displays “Financial analysis is not available in this environment.” Configuration failures are reported separately. Fictional demo balances are never substituted for a failed live request.

See [backend setup](backend-setup.md) for exact Clerk, Neon/Drizzle, Stripe, OpenAI, privacy, environment-separation and preview-verification requirements.

## Data flow

1. Documents, OCR and reconciliation remain local. The analysis selector defaults to the active reported investor and never silently consolidates all investors. Only explicitly checked report investors can be selected; changing selection clears consent, saved binding and returned commentary.
2. The panel shows actual current ownership-adjusted totals, period, currency, account count and incomplete/low-confidence indicators. Material unresolved flags, invalid values, duplicates or reconciliation failures block analysis.
3. An entitled verified user explicitly saves a minimal category summary. The API validates its strict schema and binds an immutable version to the authenticated internal UUID. No original files, names, descriptions, account numbers, filenames or OCR are stored. The server cannot independently inspect original documents that remain local; the saved confirmed data is the user's validated financial input.
4. Consent names the configured provider and approved retention notice. It starts unchecked and describes the real data boundary. The request sends only opaque saved version/investor IDs and consent/version, never financial totals or browser subscription claims.
5. The server reloads the authorized saved record, verifies its canonical hash, recomputes the scoped summary, checks persisted entitlements, and reserves usage/cost atomically. Immediately before provider access it revalidates session, primary-email verification, entitlement, version and selected data.
6. OpenAI receives only approved category labels, deterministic metrics, period/currency, anonymous scope counts, limitations and an opaque request ID. Provider instructions, structured schema, numeric/advice rejection and metric references protect the response. The UI renders facts/calculations separately from educational observations. Schema validation cannot establish semantic truth of every qualitative statement; live acceptance review is still necessary.
7. Successful validated output completes usage and writes minimal audit metadata. Failures release completed customer allowance, retain conservative uncertain provider spending, and never generate mock replacements. No customer charge is created by requesting analysis.

## Calculation and compatibility

The existing selected-investor, leaf-row, ownership and cent-rounded statement functions remain authoritative. Row overrides replace statement percentages; they are never compounded. Source totals/subtotals and unchecked rows/investors are excluded. Unresolved duplicate leaves block external processing. Unknown editable categories become approved generic categories before persistence/provider transmission. Missing prior data is unavailable for comparison, not an invented zero.

Overview, Summary, Detailed reports and the saved/AI summaries use the same cent-rounded shares. CSV included values now use those same cents; raw audit columns remain intact. Existing upload/OCR, statement assignment, row editor, duplication/deletion, printed appearance, subscription prices and free/paid branding are preserved. Commentary is excluded from printing.

Paid UI controls are presentation, not authentication or authorization for backend operations. Live AI, saved reports, Checkout, Portal and administrative actions enforce access server-side. Once financial data is in a user's own browser, client printing/copying is not an enforceable server security boundary.

## Modes

`FINANCIAL_ANALYSIS_MODE=disabled` is the Production default. Development defaults to a visibly labelled mock; set `disabled` to preview the unavailable live interface. Explicit `mock` runs the existing labelled demo only outside Production (including a separately identified Preview). `/api/financial-insights` is unavailable otherwise. `live` requires the backend, approved configuration and privacy flags, key/model/prices/limits, user session, persisted entitlement and explicit consent. No client can choose the server mode.

The live route is `/api/financial-analysis`. Safe errors distinguish data review, authorization, plan eligibility, quotas and service failure. It has same-origin checks, strict IDs-only schema and an actual streamed body limit. There is no synthetic fallback.

## Verification status

Tests cover existing parsers/reports and new data minimization, selection, persistence, authorization, entitlements, Stripe signature/idempotency, ownership, quota/concurrency, provider failures and validated output. Local Chromium checks cover report flow, selection, responsive presentation, missing-backend behavior, and explicitly labelled mock consent. A real Clerk login, Neon connection, Stripe test payment/webhook and authorized OpenAI call still require external configuration. No Vercel deployment or production activation was performed.

## Actionable eligibility and row review

`eligibility.ts` provides one pure browser/server analysis-data inspection model with safe reason codes, stable affected row IDs and counts. Service-disabled, authorization, usage and configuration states are independent of financial-data warnings. Disabled service never presents a data-review message as its cause, and remains unavailable after rows are fixed. Unexpected calculation failures produce a generic safe configuration message without exception contents.

The analysis picker and report picker now control the same investor IDs. Overview, Summary, Detailed, CSV, portfolio categories/percentages, ratios, local metadata and provider input use that selection. Financial previews include confirmed, valid leaf rows only, combine normalized category labels and omit zero asset categories and liabilities from allocation. Pending included rows are explicitly counted and excluded from confirmed totals; they continue to block external analysis until reviewed or excluded. This does not silently approve OCR values or substitute source totals.

“Review N flagged rows” opens Review & Reconcile filtered to those local IDs, retains investor selection, highlights outstanding rows and focuses the first review action. Confirm validates a row before clearing review flags; editing and saving explicitly confirms corrected values; unchecking Include excludes the row. Duplicate detection still blocks duplicate rows even after confirmation. Focus returns to the edited row, then to the analysis action or heading on return. No review IDs, descriptions, names or source files are sent for diagnostics.

The section uses human-readable statement dates, separate accessible service/review panels, a compact selector, a full-opacity navy-outline disabled action, and one secondary educational notice. Consent remains unchecked and per request; its updated wording is recorded as `financial-analysis-v2`. The server still independently validates configuration, session, email, entitlement, ownership, saved data, allowance and consent. The disabled route returns the safe `SERVICE_DISABLED` code, and does not offer a retry that could activate processing.

Regression coverage includes scoped totals/charts/provider summaries, unknown/service/auth/quota states, review/confirmation/correction/exclusion, duplicate persistence, safe unexpected errors, human dates and server denial of browser mode/premium claims. Browser verification uses synthetic records at desktop, tablet and mobile sizes; provider responses in isolated component scenarios are mocked. External Clerk/Neon/Stripe/OpenAI configuration and approval requirements remain unchanged. No live processing is enabled by this correction.

### Correction validation and files

Validated from baseline `c6e041a8750640fca767073f2eccec746ac2f804`. Default `npm test`: 162 passed, four opt-in database tests skipped. `npm run test:database`: all 166 passed with zero failures/skips in disposable PostgreSQL. Lint, TypeScript, production build and diff checks passed. Synthetic Chromium scenarios covered desktop (1440px), tablet (820px), mobile (390px), shared investor scope, flagged-row filtering, explicit confirmation/correction/exclusion, keyboard focus, consent and safe failure states. The disabled action was checked against the WCAG AA text-contrast ratio and full opacity. No hosted deployment or live external processing was used.

The correction is committed locally without pushing, because the existing Vercel integration automatically deploys Preview on branch pushes. Real authentication/provider integrations still require the separately documented configuration and approvals.

Changed files:

- `app/api/financial-analysis/route.ts`
- `app/financial-insights-panel.tsx`
- `app/globals.css`
- `app/lib/documentParser.ts`
- `app/lib/financialInsights/eligibility.ts`
- `app/lib/financialInsights/notices.ts`
- `app/lib/financialInsights/saveSummary.ts`
- `app/lib/financialInsights/selection.ts`
- `app/lib/financialInsights/server/liveHttp.ts`
- `app/lib/financialInsights/server/runtime.ts`
- `app/lib/financialInsights/settings.ts`
- `app/report-app.tsx`
- `docs/financial-insights.md`
- `tests/analysis-eligibility.test.mjs`
- `tests/report-presentation.test.mjs`
