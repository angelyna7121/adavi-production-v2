# Adavi Net Worth

A production-ready native Next.js application for the adavi.ai Net Worth Statement workflow with local document parsing.

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

This is a self-contained front end. PDF text extraction, PDF page rendering, OCR and spreadsheet parsing occur locally in the browser; statement files are not sent to a server. Authentication, database persistence, payments and production integrations remain outside this application.

The parser accepts up to 10 MB per file and reads up to 25 PDF pages. OCR, PDF.js and English language assets are bundled locally, so the application does not download OCR dependencies from a CDN at runtime.

## Subscription security dependency

The upgrade panel advertises CAD $9.99 monthly and CAD $99.99 yearly plans, but paid capabilities intentionally remain locked in this repository. Before paid report mode or CSV downloads can be enabled in production, the application requires secure authentication, Stripe Checkout, verified Stripe webhooks, persisted subscription status, and a server-side entitlement check. Browser state, local storage, query parameters, and CSS are not accepted as entitlement evidence.

Free users can create, reconcile, view, print, and save the fully detailed report as PDF. Free printed reports retain the repeating adavi.ai watermark, “Prepared by adavi.ai,” and the educational disclaimer.
