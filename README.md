# Adavi Net Worth POC

A polished, interactive proof of concept for the adavi.ai Net Worth Statement workflow with local document parsing.

## Included workflow

1. **Upload** — select PDF, JPG, PNG, CSV, XLSX or XLS statements, including scanned documents, or load the built-in sample.
2. **Review & Reconcile** — edit owners, categories, institutions, descriptions, current values, previous values, and asset/liability classifications.
3. **Net Worth Report** — view consolidated assets, liabilities, net worth, investor totals, schedules, period comparisons, and asset mix.

Missing previous-period values remain unavailable and display as **N/A**. The app does not invent prior-period amounts.

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm install
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

## Scope

This is a self-contained front-end POC. PDF text extraction, PDF page rendering, OCR and spreadsheet parsing occur locally in the browser; statement files are not sent to a server. Authentication, database persistence, payments and production integrations remain outside this standalone demo.

The parser accepts up to 10 MB per file and reads up to 25 PDF pages. OCR, PDF.js and English language assets are bundled locally, so the application does not download OCR dependencies from a CDN at runtime.
