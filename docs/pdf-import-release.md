# PDF import candidate — 2026-11-09

Status: verified locally, **not released to production**. No push, merge, Vercel
configuration mutation, billing activation, migration or promotion was performed.

## Reproduction and diagnosis

The unchanged PR #5 head (`b7e5b95e8cd912d63449aadbb1cca10d62df11b8`)
reproduced the exact reported OCR/no-candidates error in Chromium. The original
working PDF returned seven rows. Both uploaded PDFs and all customer evidence
remain outside the repository, under local private scratch storage. No document
contents, names, amounts or customer screenshots are included here.

For the failing document, both pages had zero embedded text items. All four
rotations rendered and produced OCR word boxes. Upright OCR scored highest;
page confidence was above 90, so rendering, missing OCR and rotation selection
were not the failure. The positioned parser rejected the financial-position
page because it required the literal phrase `net worth`. Full-page OCR omitted
white text on broad dark bands, including the title and dated table headings.
The section recognizer did not support descriptive asset/liability headings.
Date fragments on separate OCR words were another gap. Separately, a document-wide
embedded-text early return suppressed OCR on other pages.

## Implementation

- Classify pages independently; exclude earnings and equity/narrative regions.
- Retry inverted dark heading crops locally, then replace overlapping word boxes.
- Detect comparative dates from positioned spans on the nearest table header;
  assign by calendar order and column position, not assumed left/right order.
- Extract numeric leaves within explicit sections; retain descriptions, zeros,
  cents, null prior amounts, page/row/box provenance and original source totals.
- Use one extraction path per page; prefix row identifiers with page provenance.
- Return partial results with page-specific manual review requirements. Distinguish
  unreadable, unsupported and uncertain imports; never return an empty success.
- Preserve each uploaded file as a browser-local Blob URL, including failures.
- Require explicit review for uncertain rows or failed source controls. Recheck
  source controls after edits using raw, pre-ownership values. No balancing row
  or inferred missing balance is created.

A readable institution/account hierarchy that cannot be fully confirmed by
positioned parsing retains its legacy candidates **with mandatory review**.
An equity-only continuation is excluded when it has an explicit equity section
and no monetary rows before it or asset/liability sections.
The original working PDF still produces seven candidates, but dated-column
geometry remains unconfirmed for that legacy hierarchy; its rows are flagged.
There is no unpositioned OCR-line fallback that guesses period order.

Rounding tolerance for source asset/liability controls is one currency unit,
consistent with existing source reconciliation. Raw cents remain intact;
report/CSV calculations use the existing cent-rounded presentation model. Missing prior values carry an explicit
missing marker into printed accounts, subtotals, net worth and change, where
they display `N/A`; known zero balances still display zero.
The existing printable currency format displays whole currency units.

## Verification

Node 22.13.0 was used for release checks (the environment initially supplied
Node 24.22.1). The browser uses installed Chromium and local PDF.js/Tesseract
assets, with non-origin requests blocked.

- `npm ci` — passed on Node 22.13.0 with the final lockfile; the initial
  Node 24 installation produced the expected engine warning.
- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm test` — 175 tests: 171 passed, four opt-in database tests skipped.
- `npm run build` — passed under Node 22.13.0.
- `npm run test:pdf-browser` — all nine synthetic PDF cases passed, including
  real outlined PDFs with zero embedded text, mixed pages, dark headings,
  date columns, street numbers, cards/totals, zero/cents/missing prior values,
  partial success and distinct unreadable/unsupported failures.
- `FINANCIAL_ANALYSIS_MODE=disabled npm run start -- --hostname 127.0.0.1 --port 3000`,
  then `npm run test:report-browser` — passed against the production build:
  upload, review, editing, investor selection, report, print invocation and
  printable PDF generation, including `N/A` for missing prior values; AI disabled; CSV denied without verified entitlement;
  failed upload retained. Zero document uploads or external browser requests.
- `git diff --check` — passed.
- Both uploaded PDFs returned seven rows in the patched local pipeline. The
  failing PDF yielded six asset leaves and one liability leaf from page 2;
  current source asset/liability controls reconciled within tolerance. The
  working PDF's hierarchy is retained with the review limitation above.

Synthetic screenshots and printed PDFs are generated under ignored
`work/browser-evidence/`; supplied financial documents are never captured there.
No real Clerk login, database integration, Stripe payment, OpenAI analysis or
paid CSV authorization was verified. The existing database acceptance tests
were not run. The CSV calculation path was tested directly without granting
an entitlement or bypassing the UI gate.

## Candidate and release blockers

Candidate branch: `codex/fix-pdf-import-local-ocr`, based on the exact PR #5 head
above. Its final commit is recorded in the accompanying release evidence.
PR #5 remains open and unmerged; this parsing fix does not approve its backend.

The smallest safe feature scope is browser-local upload, manual review/editing,
investor ownership/selection, reconciliation, branded reporting and print.
These core features run without provisioning Clerk, Neon, Stripe or OpenAI.
Paid CSV/unbranded output must remain denied without a verified entitlement.
Keep `FINANCIAL_ANALYSIS_MODE=disabled`; leave privacy/configuration approval
flags unset and do not supply unverified billing/provider credentials.

The current branch includes PR #5's wider routes and integration code. A
production release requires either a reviewed frontend/report-only extraction
or independent acceptance of the complete parent PR. Do not merge that PR solely
because the parsing checks pass. No such merge or extraction was performed here.

Connected Vercel observations:

- Team `team_er9YznxIqBhnVO2eGpDppuOA` (`angelyna7121s-projects`).
- Accessible project `adavi`, ID `prj_GPg3Ck8lLFzgPbsxFlK8WDYF6oRE`, reports
  Vite and Node 24, with domains including `adavi.ai` and `www.adavi.ai`.
- Its latest READY production deployment is
  `dpl_4ZFZUgLz6dfiQneJne2Qw2apBG8w`, source `angelyna7121/adavi`, branch
  `main`, commit `a517121843427c1cc420905d68175316c1bd5830` — a different repository.
- PR #5's successful Vercel status refers to `adavi-production-v2-preview`;
  looking up that project in this team returned 404. Its current automatic
  deployment behavior could not be verified. Therefore the fix branch was not
  pushed. A previous PR description indicating Preview is historical evidence,
  not verification of today's deployment policy.

The intended production project/repository link, automatic push behavior,
production environment requirements and domain ownership/cutover must be
confirmed before any push or staged deployment. For this Next.js candidate use
Node 22 and the Next.js preset, not the observed Vite settings. No deployed
upload → reconcile → report smoke test has run; production is not claimed fixed.

## Staging and rollback plan

1. Confirm the exact intended Vercel team/project, repository link, production
   branch, framework/runtime and automatic deployment policy. Record the final
   reviewed candidate commit, feature scope and environment-variable names only.
2. Retain and independently smoke-test the current READY deployment and capture
   existing domain assignments/DNS before cutover. No older READY rollback
   candidate was established in the three observed deployment records (the two
   preceding deployments were ERROR). Do not assume an untested rollback works.
3. After repository review/release gates pass, stage a production-environment
   build without domain assignment. Keep AI disabled and billing inactive;
   do not run migrations for the local reporting scope.
4. Run the synthetic browser pipeline and upload → reconcile → report → print
   smoke against the exact staged production build. Verify authorization denies
   paid exports and no document data leaves the browser. Promote only that
   verified artifact after the project's required review/approval gates pass.
5. On a blocking regression, return aliases/traffic to the retained, verified
   previous READY deployment in the confirmed target project. If DNS was changed,
   restore captured records too. Verify the same smoke test after rollback.
   If reusing `adavi`, the observed READY deployment above is a preservation
   baseline, not yet a verified rollback target for this separate repository.

## Exact changed files

```text
.gitattributes
app/lib/documentParser.ts
app/lib/financialPositionParser.ts
app/lib/ocrDarkBands.ts
app/lib/ocrFinancialParser.ts
app/lib/reportData.ts
app/report-app.tsx
docs/pdf-import-release.md
eslint.config.mjs
package-lock.json
package.json
tests/browser/pdf-pipeline.mjs
tests/browser/report-workflow.mjs
tests/financial-position-parser.test.mjs
tests/fixtures/pdf/README.md
tests/fixtures/pdf/embedded.pdf
tests/fixtures/pdf/generate.py
tests/fixtures/pdf/missing-prior.pdf
tests/fixtures/pdf/mixed-earnings-outlined.pdf
tests/fixtures/pdf/mixed-position-pages.pdf
tests/fixtures/pdf/outlined.pdf
tests/fixtures/pdf/partial.pdf
tests/fixtures/pdf/unreadable.pdf
tests/fixtures/pdf/unreconciled.pdf
tests/fixtures/pdf/unsupported.pdf
tsconfig.json
```
