# Adavi Net Worth

A native Next.js application for the adavi.ai Net Worth Statement workflow with local document parsing.

## Included workflow

1. **Upload** — select PDF, JPG, PNG, CSV, XLSX or XLS statements, including scanned documents, or load the built-in sample.
2. **Review & Reconcile** — edit owners, categories, institutions, descriptions, current values, previous values, and asset/liability classifications.
3. **Net Worth Report** — view consolidated assets, liabilities, net worth, investor totals, schedules, period comparisons, and asset mix.

Missing previous-period values remain unavailable and display as **N/A**. The app does not invent prior-period amounts.

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm ci
npm run dev
```

Open the local URL shown in the terminal.

## Production build

```bash
npm run build
npm run start
```

## CSV format

The importer recognizes common headers such as:

```csv
investor,category,institution,description,current value,previous value,type
Primary Investor,Bank Accounts,National Bank,Chequing,12500,11000,asset
Primary Investor,Mortgages,National Bank,Home mortgage,320000,,liability
```

The description and current-period value are required. Type may be `asset` or `liability`.

## Quality checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Scope

PDF text extraction, PDF page rendering, OCR and spreadsheet parsing occur locally in the browser; statement files are not sent to a server. The optional authenticated backend persists only explicitly saved anonymous category summaries. External integrations remain disabled until configured and verified.

The parser accepts up to 10 MB per file and reads up to 25 PDF pages. OCR, PDF.js and English language assets are bundled locally, so the application does not download OCR dependencies from a CDN at runtime.

## Subscription security dependency

The existing upgrade panel and advertised prices remain unchanged. Paid capabilities now use Clerk-backed persisted entitlements and verified Stripe webhooks, and remain locked when the backend is unavailable. Configure approved Stripe Prices to match the approved offer before enabling Checkout. Browser state, local storage, query parameters, and CSS are not accepted as backend entitlement evidence.

Free users can create, reconcile, view, print, and save the fully detailed report as PDF. Free printed reports retain the repeating adavi.ai watermark, “Prepared by adavi.ai,” and the educational disclaimer.

## Authenticated backend and financial insights

The optional backend uses Clerk, Neon PostgreSQL with Drizzle, Stripe and a server-only OpenAI adapter. Analysis defaults to disabled until configuration and privacy approvals are complete. Local document parsing and report creation work without those services. See [backend setup and preview verification](docs/backend-setup.md) and [analysis data flow](docs/financial-insights.md).

Schema migrations are in `drizzle/`. Run `npm run db:migrate` only against an explicitly approved development/preview database. `npm test` includes database integration tests when `RUN_DATABASE_TESTS=1` and an isolated development/preview `DATABASE_URL` are configured; otherwise those tests are reported as skipped. Never use a production database for tests.
