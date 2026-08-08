# Production launch runbook

This runbook deliberately keeps deployment separate from code review. **Do not connect Vercel or change `adavi.ai` until the production pull request has passed CI, been reviewed, and merged.**

## 1. Pre-merge verification

1. Confirm the pull request targets `main` and CI is green.
2. Review Upload → Review & Reconcile → Net Worth Report with the sample data.
3. Exercise PDF, scanned PDF, JPG/PNG, CSV, XLS, and XLSX inputs in a supported browser.
4. Confirm files over 10 MB are rejected, unreadable files produce an honest error, required descriptions/current values block report generation, and unavailable previous values display `N/A`.
5. Confirm browser developer tools show no statement upload and no OCR/PDF asset request to a third-party CDN.

## 2. Release gate

Run from a clean checkout with Node.js 22.13 or newer:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

Merge only after every command and the GitHub Actions workflow pass.

## 3. Vercel setup (only after approval)

1. Import the merged GitHub repository into the approved Vercel team.
2. Use the native Next.js framework preset, `npm run build`, and the repository's Node.js version.
3. Create a preview deployment first. Do not attach the production domain.
4. Repeat the workflow and privacy checks against the preview URL.
5. Record reviewer approval and a rollback owner before promoting production.

## 4. Domain cutover

1. Capture the existing `adavi.ai` DNS records and lower TTL only during the approved window.
2. Attach and verify the domain in Vercel; change DNS only after preview acceptance.
3. Verify TLS, apex and `www` redirects, browser parsing, and the full report workflow.
4. Monitor errors immediately after cutover. Restore the captured DNS records if a blocking regression occurs.

## 5. Post-launch

- Save the deployed commit SHA and validation evidence in the release record.
- Restore normal DNS TTLs.
- Re-run smoke tests and confirm no uploaded statement data appears in server or analytics logs.
