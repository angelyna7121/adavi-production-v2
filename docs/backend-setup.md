# Backend setup and release verification

The application now contains a Next.js App Router backend for Clerk, Neon PostgreSQL through Drizzle/node-postgres, Stripe and OpenAI. No production resources, credentials, payments or customer processing were activated. Production financial analysis defaults to disabled; development defaults to an explicitly labelled mock unless overridden. Missing/invalid configuration returns “Financial analysis is not yet available.”

## Configuration

Configure values securely in the correct Vercel environment or a local ignored environment file. Never paste secrets into chat, source or logs. Public Clerk/Stripe publishable keys are the only intended public credentials.

| Name                                        | Required use                                                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_URL`                                   | Exact HTTPS application origin, without a path; local HTTP only outside production. Used for same-origin/session checks and Stripe return URLs.               |
| `APP_DATA_ENV`                              | `development`, `preview`, or `production`; production runtime checks reject a mismatched data environment.                                                    |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`         | Clerk publishable key for the matching instance.                                                                                                              |
| `CLERK_SECRET_KEY`                          | Server Clerk key. Development/Preview require `sk_test_` and `pk_test_`; Vercel Production requires production instance keys.                                 |
| `DATABASE_URL`                              | Neon runtime PostgreSQL URL. Remote connections require a `.neon.tech` hostname and verified TLS. Use a restricted runtime database role and a pooler URL.    |
| `DATABASE_MIGRATION_URL`                    | Optional direct Neon URL for schema migrations; falls back to `DATABASE_URL`. Keep migration privileges separate from runtime.                                |
| `STRIPE_MODE`                               | Defaults to `test`. Live keys require both explicit live mode and the production environment. Do not set live mode during this task.                          |
| `STRIPE_SECRET_KEY`                         | Matching Stripe test secret key.                                                                                                                              |
| `STRIPE_WEBHOOK_SECRET`                     | Test endpoint signing secret.                                                                                                                                 |
| `STRIPE_MONTHLY_PRICE_ID`                   | Approved active monthly recurring Price ID in the correct Stripe account/mode.                                                                                |
| `STRIPE_YEARLY_PRICE_ID`                    | Approved active annual recurring Price ID in the correct Stripe account/mode.                                                                                 |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`        | Optional public key; hosted Checkout currently uses server-created redirects and does not need it.                                                            |
| `FINANCIAL_ANALYSIS_MODE`                   | `disabled` (Production default), `mock` (development default), or `live`. Mock is allowed in development/test or an explicitly identified Vercel Preview; rejected in Production.              |
| `OPENAI_API_KEY`                            | Server-only OpenAI credential. Never `NEXT_PUBLIC_*`.                                                                                                         |
| `OPENAI_FINANCIAL_ANALYSIS_MODEL`           | Explicitly approved supported structured-output model; no live default. Existing adapter supports `gpt-4.1-mini`, `gpt-4.1`, `gpt-4o`, `gpt-4o-mini`.         |
| `FINANCIAL_ANALYSIS_DAILY_LIMIT`            | Positive integer; defaults to five completed/reserved analyses per user/day.                                                                                  |
| `FINANCIAL_ANALYSIS_REPORT_LIMIT`           | Positive report-version allowance; defaults to three.                                                                                                         |
| `FINANCIAL_ANALYSIS_MONTHLY_COST_LIMIT`     | Required maximum provider cost per user account/calendar month, in USD.                                                                                       |
| `FINANCIAL_ANALYSIS_REQUEST_COST_LIMIT`     | Required conservative per-request provider-cost reservation, in USD. Must cover the provider adapter's byte/token upper bound and fit within the monthly cap. |
| `AI_INPUT_USD_PER_MILLION`                  | Approved current input-token rate for the configured model.                                                                                                   |
| `AI_OUTPUT_USD_PER_MILLION`                 | Approved current output-token rate. No rates are hard-coded into the UI.                                                                                      |
| `FINANCIAL_ANALYSIS_PRIVACY_APPROVED`       | Must explicitly be `true` before live dependencies can load. Leave unset until approval is recorded.                                                          |
| `FINANCIAL_ANALYSIS_RETENTION_NOTICE`       | Actual approved provider retention disclosure shown in consent; no assumed retention/residency guarantee.                                                     |
| `FINANCIAL_ANALYSIS_CONFIGURATION_VERIFIED` | Must explicitly be `true` only after the integration gates below pass. Leave unset now.                                                                       |
| `DEMO_ANALYSIS_ALLOWANCE`                   | Optional existing development mock allowance, one–twenty.                                                                                                     |

There is no Owner email allowlist. Owner roles and complimentary/report-pass grants come only from persisted entitlement rows. An authorized database operator must provision the initial Owner against the internal user UUID after that user signs in. Do not auto-grant Owner based on an email or environment flag. The Owner-only `/api/admin/entitlements` route can grant time-limited complimentary/report-pass access and revoke grants; ordinary users cannot grant themselves access. Report passes do not include AI usage.

## Clerk

1. Create a separate Clerk development/test instance for local development and Vercel Preview. Enable primary-email verification and configure `/sign-in`, `/sign-up` and your approved application origins/redirects.
2. Add the instance's test keys to Development/Preview only. Set `APP_URL` to the exact current preview origin and `APP_DATA_ENV=preview` for preview runtime. Production keys must never be copied into Preview.
3. Verify middleware/session validation with real sign-in, sign-out, session expiry, revocation, unverified primary email, and two independent accounts. The backend calls Clerk server APIs and reloads primary-email verification; it never uses an editable email field or browser entitlement flag.
4. The first authenticated request upserts an internal user UUID and a verified-email boolean. No email address or customer name is stored in the application database.

## Neon and Drizzle

1. Create dedicated development and preview Neon branches/databases. Do not use the production URL in tests or Preview. Set the runtime pooled URL and, if required, a separate direct migration URL.
2. Inspect `drizzle/0000_financial_backend.sql`, then run `npm run db:migrate` **only against the approved development/preview database**. `npm run db:generate` generates future migrations from the schema; do not use schema push in production.
3. The migration creates users, reports, report_versions, investors, entitlements, subscriptions, ai_analysis_requests, stripe_webhook_events and audit_events. Schema versioning uses Drizzle's migration journal. Migrations are not run automatically during npm installation or application startup.
4. Use least-privilege runtime credentials. Confirm cross-user isolation using application routes, concurrent transactions on separate connections, connection exhaustion and reconnect behavior. PostgreSQL advisory transaction locks serialize usage reservations across Vercel instances.
5. Specify data-retention/deletion periods and operational recovery for abandoned reservations. Reservations stay conservative after ambiguous provider failures; failed requests do not count as completed customer usage, while possible external costs remain reserved.

Uploaded files continue to be parsed in the browser. Saving is explicit and requires a verified authenticated account. The save endpoint accepts only approved per-investor category balances, ownership-adjusted cents, period/currency, account/completeness counts, and newly generated opaque references. It rejects names, free-form categories, account numbers, filenames, OCR and extra fields. The server validates and hashes the canonical summary, binds it to its owning user, and creates an immutable version. IDs alone do not authorize reads or analysis. The current save flow creates a new immutable report/version per save; it does not overwrite historical versions.

## Stripe test mode

1. Create new approved monthly and annual recurring test Prices. Do not reuse values, pricing assumptions, code or credentials from the older application without inspection. Set the Price IDs only in the matching environment. Checkout retrieves each Price server-side and checks active status, interval and mode.
2. Configure a test webhook at `/api/billing/webhook`. Subscribe to `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, and `charge.dispute.created`.
3. Configure the test Customer Portal with the approved cancellation behavior. Checkout/Portal routes require verified authentication and same-origin JSON. Customer IDs are mapped server-side, never taken from the request body.
4. Test a completed subscription, failed payment, cancellation/expiry, refund, dispute, duplicate event and out-of-order event. Signature verification uses the exact bounded raw body. Event insertion and entitlement updates commit atomically. Webhook failures return non-success so Stripe can retry.
5. Verified webhooks and current Stripe subscription retrieval are payment truth. Success query parameters never unlock access. Refund revocation persists even if a later activation event arrives. Current report-pass grants are administrative; this change sells recurring subscriptions only.
6. Verify purchased plan terms and AI included-usage disclosures before releasing Checkout. No new prices, live Checkout sessions or payments were created by this task.

## OpenAI and consent

Keep live mode disabled until the approved provider/model, key, token prices, cost bounds and actual privacy disclosure are configured and reviewed. The server must have real sessions, a working database, persisted entitlements and budget allowance before provider invocation. It reloads authorization immediately before the call. There is no fallback from a failed live request to synthetic commentary.

The provider receives canonical categories, aggregate metrics, periods, currency, anonymous scope counts, completeness limitations and an opaque request ID. Names, raw rows, files, account numbers and investor identifiers are excluded. The UI shows names locally and requires new unchecked consent for every external request. `store:false` does not prove zero retention or Canadian residency. Obtain privacy/legal approval for processing, retention, residency, user consent and educational language. Validate model grounding in an authorized synthetic live-provider acceptance run before any separately approved customer processing.

## Preview verification (not executed against Vercel)

A hosted preview requires a separately authorized deployment; none was created here. For the existing Vercel project, once deployment is authorized:

1. Add isolated Preview Clerk/Neon/Stripe-test bindings. Start with `FINANCIAL_ANALYSIS_MODE=disabled` or explicitly labelled `mock`, and both live approval flags unset.
2. Deploy a preview of this branch without attaching or changing the production domain. Set its exact `APP_URL`, authorize that origin in Clerk and register its Stripe test webhook.
3. Run the migration against the preview branch only. Sign in as two verified test users, confirm saving/reading only each user's summaries, and test free/Premium/Owner/complimentary/report-pass decisions.
4. Reconcile one investor, save the minimum summary, compare report/CSV/AI values, and inspect requests for prohibited identifiers. Change scope/version and verify stale results/bindings are cleared. Test intentional consolidation and excluded investors.
5. Exercise missing consent, duplicate submissions, low-confidence material rows, quotas, provider timeout/malformed output and revoked sessions. Check no financial payload enters ordinary logs/audit metadata.
6. Verify Stripe test Checkout, Portal and actual signed delivery/retries, then the approved synthetic OpenAI acceptance call with no customer information. Record output validation and cost ceilings.
7. Only after approvals and successful evidence should an operator mark configuration verified. Production activation, live Stripe keys and customer processing remain a separate release decision.

## Current evidence and limitations

`npm run test:database` creates a disposable local PostgreSQL container from the pinned tested image, applies the migration, runs the complete suite, then removes the container and temporary credentials. It requires Docker and never uses an existing database URL.

Database integration tests against another approved isolated development database require explicit `RUN_DATABASE_TESTS=1` and a non-production isolated local/development/preview database; otherwise they are skipped. Never point tests at Production.

The PostgreSQL migration and repeat migration ran against an isolated local PostgreSQL 17 database. Tests exercise real Drizzle persistence, user isolation, concurrent reservations, and webhook/entitlement updates with deterministic mocked Stripe API responses. SDK-generated Stripe signatures are verified with the real SDK. Clerk identity/session data and AI responses are mocked. Local PostgreSQL is not a verified Neon deployment, and mocks are not verified Clerk/Stripe/OpenAI integrations. Exact final counts and browser evidence are in the delivery report.

For a restricted cloud development network, allow server HTTPS requests to `api.clerk.com`, `api.stripe.com` and `api.openai.com` only as needed. Add the exact assigned Neon hostname once the development branch exists and verify PostgreSQL/TLS connectivity; no Neon destination has been guessed. Clerk frontend asset hosts depend on the configured instance. Domain allowlisting alone does not configure credentials or prove connectivity.
