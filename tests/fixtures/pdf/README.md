These PDFs contain invented accounts and amounts only. No uploaded statements,
customer text, values, or screenshots are included.

`generate.py --output tests/fixtures/pdf` regenerates them using Python 3,
ReportLab, FontTools, and DejaVu Sans (supply `--font` for another local font).
Outlined pages draw glyph paths, not text or image snapshots. The browser test
asserts that both pages of `outlined.pdf` have zero embedded text items.

Run `npm run test:pdf-browser` with a local Chromium executable at
`/usr/bin/chromium`, or set `CHROMIUM_PATH`. All PDF/OCR assets are served from
localhost; the test rejects external requests. The nine fixtures cover earnings
before financial position, mixed embedded/outlined pages, white text on dark
headings, descriptive sections, comparative dates, street numbers, summaries,
subtotals, equity/income exclusion, zeros, cents, missing prior values,
unreconciled controls, partial success, unreadable and unsupported pages.
Low-confidence OCR and reversed columns have deterministic unit coverage in
`tests/financial-position-parser.test.mjs`.

`TEST_BASE_URL=http://127.0.0.1:3000 npm run test:report-browser` checks the real
application workflow with invented data. It expects AI disabled and a visitor
without paid entitlement. It verifies CSV denial rather than bypassing access.
Synthetic screenshots and print output are written under ignored `work/`.
