# Cloudflare demo deployment handoff

Updated 2026-10-02. The requested free Cloudflare migration, deployment and code push are complete. This checklist was created when Codex weekly usage was 97% (five-hour window 43%) and updated after deployment.

## Completed

- Migrated the app to OpenNext on Cloudflare Workers. Preserved patient, doctor and admin workflows and the original Node disk backend.
- Removed R2 completely. A SQLite-backed Durable Object persists the original JSON schema and private document bytes. Uploads remain limited to the existing 5 MB; 256 KB BLOB chunks avoid SQL row limits. Record/file changes commit together; failures roll back both.
- Preserved the actual local demo snapshot, including all record IDs and six private PDFs. Local data was not reset. A fresh Durable Object imports a private generated bootstrap once; subsequent deployments never replace live demo edits.
- Passed typecheck, all 37 API/snapshot/workerd tests, the full OpenNext build and deployment dry run (gzip 1402.34 KiB). All five Cloudflare browser checks passed. The original 15 Node browser tests passed before the final storage-only adaptation.
- Runtime checks cover exact data and byte preservation, 5 MB uploads, private downloads, rollback, deletions, concurrent bookings, Unicode JSON above 2 MB, session recovery and restart/redeployment persistence.
- Deployed successfully without R2 activation, credit-card setup or paid upgrade: https://lkwellnesscenter-poc-package.smruti-sutlejsoft.workers.dev
- Latest manual Worker version: `a79c53e6-120d-4ca3-9a19-eaf91ca2b21e`. Stable Durable Object ID: `lk-wellness-demo-v1`; class `DemoData`. Do not rename these or delete the namespace for code changes.
- Verified the live login directory, all six account sign-ins and all three portal types, all six PDF bytes, secure HTTP-only cookies and rejection of unauthenticated downloads. Signed out each verification session afterward.
- A live account profile was edited between checks; subsequent checks use its current identifier. Preserve live edits rather than restoring the original bootstrap.
- Committed and pushed the implementation to `main`: `7f2bdf941784be7531afb9211fb7ee2869b240ee`. Remote main matched this commit immediately after push. This checklist is committed afterward as deployment documentation.
- Installed official Cloudflare agent skills and registered the cloudflare, cloudflare-docs, cloudflare-bindings, cloudflare-builds and cloudflare-observability MCP servers. OAuth succeeded for the four authenticated servers; the docs server requires no OAuth.
- Saved future deployment instructions in `docs/DEPLOY-COMMANDS.md` and storage/CI details in `docs/CLOUDFLARE.md`. Wrangler prepares the private bootstrap automatically for direct deploys and Git builds. No payment activation is necessary for the services used; free quotas are documented with official sources.

## Pending

- No application migration or manual deployment work remains.
- Preserve the user's preexisting, unstaged changes to `docs/LK_Wellness_POC_Demo.pptx` and `docs/LK_Wellness_POC_Demo_Guide.docx`; they were intentionally excluded from the deployment commits.
- For future changes, review Git status, run the documented checks, commit/push, then deploy. A configured Cloudflare Git build may deploy automatically; manual deployment has already completed for this task.

## Instructions for a future agent

1. Work from `D:\SuttlejSoft\POC programs\LK wellness POC\codebase` (this is the Git repository root). Remote: `https://github.com/Smruti5808/lkwellnesscenter-poc-package.git`; branch `main`.
2. Read `AGENTS.md` and the relevant bundled Next.js documentation before editing code. Use the installed Cloudflare skills when changing storage or deployment.
3. Read `docs/DEPLOY-COMMANDS.md`. Do not run `data:reset`, delete the Durable Object namespace or activate R2/paid services. Local data scripts operate only on Node's JSON file, not the hosted database.
4. Confirm Git state with `git status`, `git log -2 --oneline` and `git ls-remote origin refs/heads/main`. Documentation may be a newer commit than the implementation commit recorded above.
5. Wrangler authentication is already configured for account `51a63807093c56cb365af1dc123bf7a5`. Never output secrets. Global credentials require elevated command execution in this sandbox.
6. Elevated Git mutations use command-scoped `-c safe.directory='D:/SuttlejSoft/POC programs/LK wellness POC/codebase'` because elevated and sandbox users differ. Avoid changing global Git settings.
7. For sandboxed Wrangler commands, point `WRANGLER_LOG_PATH` and `WRANGLER_REGISTRY_PATH` to repo `tmp` directories. Miniflare 5 tests use `resourcePersistencePath` through `convertV4MiniflareOptions`.
8. On this Windows sandbox, Playwright's webServer teardown can hang after all browser tests pass. A separately managed server and config with `webServer: undefined` previously completed cleanly. The production deployment and runtime tests work normally.

## Evidence

Ignored local `tmp/live-verification.json` records live checks; `tmp/verify-live.cjs` repeats sign-in/download verification while preserving current live account identifiers. Generated bootstrap `cloudflare/bootstrap.generated.json` and snapshots `tmp/cloudflare-import/` are private and ignored by Git. Do not publish them as static assets or commit runtime data.
