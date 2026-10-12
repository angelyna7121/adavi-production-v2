# Optional financial insights — PR #5 implementation

This change adds **✨ Analyze My Financial Position** below the current net worth and assets/liabilities cards. It is optional, never runs from upload, OCR, editing, report viewing or printing, and is excluded from the existing printed statement.

## What is enabled

Only a synthetic demonstration is enabled. The consent dialog explains the difference between this demo and future external AI processing. A request contains exactly `{mode:"demo", scope:"individual"|"consolidated", consent:true}`. No customer financial data, names, investor IDs, documents, statement dates or currency selections are sent. Server-owned, explicitly synthetic fixtures are processed by the existing financial engine, and eight sections of **handwritten demonstration commentary** reference verified metrics. This is not a real model response.

The browser supports loading, cancellation, safe failure/retry, collapsible sections, reopening without another request, and separate individual/consolidated examples. It validates returned section IDs and references before displaying results. Currency and percentages retain the existing whole-number display. The real report above the panel is not changed. Local demo state is reset when the selected real report scope, balances, ownership, period or currency changes; the server fixture itself remains independent of customer information.

## Repository audit and financial authority

- Next.js 16.2.6 App Router, React 19.2.6, TypeScript 5.9.3; Node 22.13.0 in CI.
- PDF.js, Tesseract and spreadsheet parsing run locally in the browser. OCR assets are bundled. There was no API route, database, persistent record store, authentication or storage backend.
- `confirmedDetailRows`, `deriveSelectedInvestorReport`, `buildInvestorStatement`, and `statementPresentation` produce the selected, deduplicated, ownership-adjusted printable report. Insights reuse those functions; no alternate calculation engine was introduced.
- `applyOwnershipToRow` and `setRowOwnershipOverride` preserve the established replacement, rather than compounded, ownership rule.
- `calculatePeriodTotals`/`reconcileCategory` continue to serve the existing reconciliation controls and source-subtotal tolerance. Those functions and the treatment of Loans Receivable were not changed. The insights summary follows the same leaf-based, cent-rounded presentation model as the existing printed statement.
- Missing prior-period values are marked unavailable for interpretation; the existing application's printed-zero behavior is not changed. Ratios have a null value when the denominator is unavailable or nonpositive. Mixed currencies are rejected; no exchange-rate assumption is made.
- `getVerifiedPaidEntitlement()` remains server-only and always false because no authenticated subscription store exists. Subscription prices, premium controls, uploads, investor assignment, CSV and entitlement logic are unchanged.
- Printing remains the existing A4 Overview / Summary / Detailed document, with separate numbering. No Consolidated Schedule is reintroduced.

## Architecture and security

`contracts.ts` defines the minimal summary, evidence references, section schema and strict runtime validation. Numeric commentary, arbitrary scores, markup, URLs, unsupported metric references and extra fields are rejected. Metrics are rendered using ADAVI formatting, never overwritten from model output. Semantic truth of a narrative cannot be guaranteed solely by schema validation; live output still needs acceptance review and monitoring.

`summary.ts` accepts an already authorized report from application code, not a request's totals. It excludes raw rows and documents. Unrecognized user-defined category labels become generic labels rather than untrusted prompts or personal information. Incomplete comparisons and remaining review flags are disclosed. Income and equity are not introduced as categories.

`/api/financial-insights` accepts same-origin JSON POSTs only, requires explicit consent, limits the actual streamed body to 2 KB, and rejects extra fields including fake premium claims, investor IDs and totals. A `mode:"live"` request always returns `LIVE_AUTHORIZATION_UNAVAILABLE`, even if an API key is set. No flag activates real customer processing. The route has a bounded Vercel execution duration and safe error responses, no financial prompt logging and no browser secrets.

The synthetic-only service has opaque HttpOnly, SameSite=Strict, host-only session cookies (Secure over HTTPS), separate session/scope/version/configuration cache keys, concurrent request deduplication, 15-minute cache expiry, bounded memory, per-session/global throttles and a demo allowance. These process-local controls **are not authentication, durable billing or global limits across Vercel instances**. Only public synthetic data is cached. A client can create a new demo session; the process-wide rate bound limits abuse within one process. Cold starts and multiple instances reset/partition limits. This is acceptable for the unbilled demo and insufficient for live analysis.

Usage records contain request, success/failure, token and latency counters with estimated provider cost. Demo token usage and provider cost are always zero. Records avoid names and financial details and are bounded in memory. No user charge, checkout flow or subscription price is introduced.

## OpenAI adapter — implemented but not activated

`FinancialAIProvider` is provider independent; a future Claude adapter can implement the same interface. `OpenAIProvider` uses Chat Completions structured outputs with a strict JSON Schema, `store:false`, a bounded output-token budget and a request deadline. It validates all output against authorized metrics, rejects refusals/truncation and returns normalized errors. Only an explicit rate-limit rejection is retried once. Ambiguous network failures/timeouts are not automatically retried because processing may already have incurred a charge. Abort signals are supported; aborting an HTTP request does not guarantee cancellation of provider billing.

`server/index.ts` has a `server-only` boundary for configuration. No UI module imports the provider or credential loader. The route never instantiates it. Tests use an injected mock transport; they do not call a paid API.

Future server-only configuration, after approval:

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Required for a future live OpenAI integration; never `NEXT_PUBLIC_*`. |
| `OPENAI_MODEL` | Default `gpt-4.1-mini`; only supported structured-output model names are accepted. |
| `AI_INPUT_USD_PER_MILLION` | Reviewed provider input-token price for cost estimates. |
| `AI_OUTPUT_USD_PER_MILLION` | Reviewed provider output-token price for cost estimates. |
| `DEMO_ANALYSIS_ALLOWANCE` | Optional synthetic-session allowance, 1–20; defaults to 4. No real entitlement is implied. |

Missing pricing means estimated live cost is unknown, not zero. A future live ledger must reserve a conservative maximum request cost before making a provider call. No credentials or production environment variables were changed in this task. API access and credits are separate from a personal ChatGPT subscription.

The supported structured-output contract and model names were checked against the official OpenAI Node SDK source (`openai/openai-node`, `src/resources/shared.ts`). The official structured-output and API data-retention documentation pages returned HTTP 403 from this environment. There is no configured provider contract or organization retention setting to inspect. `store:false` does **not** establish zero retention, Canadian residency or a completed privacy review. Before real financial data is processed, review the current [OpenAI API data controls](https://platform.openai.com/docs/guides/your-data), actual organization settings, applicable contract and consent requirements.

## Live prerequisites and deferred work

`livePrerequisites.ts` provides integration contracts for authenticated customer resolution, authorization of every selected investor, server-owned financial records, and a durable atomic reservation ledger. Allowance types are complimentary, premium, owner, promotional and report-pass. These are contracts, not fake operational authentication or new paid entitlements.

Before enabling any live route, implement and review:

1. Authentication, persisted authorization and server-side records. Browser IDs, totals and premium flags cannot be trusted; verify ownership and recompute using the same financial engine.
2. A durable database transaction that combines allowance/budget reservation, idempotency and per-customer/scope/data-version/model cache lookup across Vercel instances. Define failure/timeout billing and refund rules, finite retention and deletion.
3. Verified subscription/owner/promotional entitlement sources and approved allowances; no new charges without approval. Existing subscription prices remain unchanged.
4. Provider privacy/retention review and external-processing consent with approved charge/limit disclosures; key management, access monitoring and rate controls.
5. A deliberate, separately reviewed live activation change. Merely setting a key or model cannot enable it here.
6. Live-provider acceptance and security testing using approved synthetic fixtures, followed by explicit owner authorization for real customer processing.

An AI Insights PDF appendix is deferred: this task keeps insights out of the mature print/pagination path. A separate opt-in appendix needs its own consent, provenance, entitlement and pagination tests.

## PR #6 compatibility

PR #5 started at `25cf5015d91d012ab03c49c884fec8a082e14dad`; main was `52e0c422fc2ef9bc2ee689129f5c5aeaee836afe` and is already an ancestor. PR #6 was inspected at `ec374e443d0ed1f77b5fa388530b12371a3c3768`. It changes `app/page.tsx`, `app/globals.css`, `app/lib/documentParser.ts`, adds `app/lib/netWorthReport.ts`, and adds tests. Its report model is an alternate implementation based on older main, with a different ownership field and report title/period machinery. A merge-tree simulation confirmed content conflicts in `app/globals.css`, `app/lib/documentParser.ts`, and `app/page.tsx`; no merge or working-tree change was performed. It overlaps PR #5's existing report and print work.

This change preserves PR #5's architecture and does not merge, rewrite or modify PR #6. Recommended review order: review PR #5 as the authoritative investor/report path, then rebase/rework PR #6 against the approved result and retain only still-needed nonduplicating changes. A blind merge risks replacing the server page entry point (which loads verified entitlements), losing the new optional panel and conflicting in parser/CSS behavior.

## Validation and review

Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check` using Node 22.13.0. Automated tests cover the unchanged engine, ownership, missing comparisons, currency isolation, data minimization, output validation, mocked provider errors/timeouts/cancellation/retry, synthetic session isolation, concurrent deduplication, quotas, origin/body limits, forged access claims and mandatory consent.

Browser and PDF results, final commit and deployment verification are recorded in the delivery report alongside this PR. Live AI, real authentication, durable entitlements and paid processing remain unverified and disabled. Owner review is appropriate for the synthetic feature; this is not production readiness for customer AI processing.
