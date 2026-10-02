# Deploy the demo free on Cloudflare Workers

For later changes, use the short [command list](DEPLOY-COMMANDS.md).

The Next.js UI and existing API workflows are retained. A single SQLite-backed Durable Object stores the existing JSON schema and private document bytes and serializes complete API transactions. Records and upload writes/deletions commit atomically. Files use 256 KB BLOB chunks, preserving the app's existing 5 MB upload limit. Node development and original data scripts still use local JSON and files.

## First deployment

Run from the repository root (`codebase` in this checkout), with Node.js 22 or newer. On Windows use `npm.cmd` / `npx.cmd` if PowerShell blocks npm scripts. OpenNext recommends Linux/WSL when troubleshooting Windows builds.

```sh
npm ci
npx wrangler login
npm run typecheck
npm test
npm run deploy:cloudflare
```

Use **Workers Free**. No R2 bucket, credit card, paid subscription or storage activation is needed. SQLite Durable Objects are included in the free plan. [Cloudflare's pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) documents the current allowances: 100,000 requests/day, 5 million SQL row reads/day, 100,000 row writes/day and 5 GB total SQL storage. Free-limit exhaustion fails requests rather than charging overages. Workers also has its own [free platform limits](https://developers.cloudflare.com/workers/platform/limits/).

`deploy:cloudflare` captures the current local `data/app-data.json` and every referenced document while holding the existing local file lock, then builds and deploys. Every record ID and document byte is retained. A clean checkout without a data file uses the bundled dummy seed and six demo PDFs. Corrupt JSON or missing referenced documents aborts instead of silently replacing data.

The snapshot is privately bundled into the Worker, never served as a static asset. On the first API request, a fresh Durable Object imports both records and files in one SQLite transaction. Later deployments **do not overwrite initialized live data**. Downloads retain the existing session and patient-access checks. There is no public reset/import endpoint. Do not rename the Durable Object class, change its stable ID (`lk-wellness-demo-v1`), or delete its namespace for code updates.

Wrangler also runs the bootstrap preparation before bundling, so direct deploys and Git builds prepare the ignored module even if their build command calls OpenNext directly. Workers.dev is explicitly enabled; separate version preview URLs are disabled.

To capture or prepare the private snapshot independently:

```sh
npm run data:cloudflare:export
npm run data:cloudflare:prepare
```

Snapshots are written under ignored `tmp/cloudflare-import/`; the prepared bundle is ignored `cloudflare/bootstrap.generated.json`. Original local JSON and PDFs remain intact. Local edits after first deployment are separate from edits on the hosted demo. Preparing/rebuilding the bundle does not sync or reset live data. The initial bundled snapshot must fit the free Worker compressed code-size limit; this demo's bundled data/PDFs fit, while arbitrary large future initial datasets may not. Uploads made through the hosted app go directly to SQLite rather than expanding the Worker bundle.

## Cloudflare Git build settings

Use Worker **`lkwellnesscenter-poc-package`**. The Wrangler config sets the Worker name and `WORKER_SELF_REFERENCE` to this same name.

- Root directory: repository root. This Git repository already starts inside `codebase`.
- Build command: `npm run build:cloudflare`.
- Deploy command: `npx wrangler deploy`.
- Dependency installation: `npm ci` (normally automatic).

Complete the first manual deployment from the checkout holding your current demo data before enabling automated Git builds. Subsequent Git builds can use the fallback seed bundle safely because initialized hosted records/files are retained.

## Local Worker preview and checks

```sh
npm run preview:cloudflare
```

This prepares the bootstrap, builds and starts the complete Worker against local Wrangler SQLite storage. It does not modify the cloud deployment. `npm run dev` continues to run the original Node app with its local JSON data.

```sh
npm run typecheck
npm test
npm run build:cloudflare
npx wrangler deploy --dry-run
npm run test:e2e:cloudflare
```

The workerd runtime test checks exact initial records and file bytes, private downloads, maximum-size 5 MB uploads, deletions, rollback, simultaneous bookings, JSON over 2 MB with Unicode, sessions and restart/redeployment persistence. The Cloudflare browser suite runs the full OpenNext Worker with all three portals in isolated local storage. The 33 original API tests and original browser suite remain available.

`data:seed`, `data:reset` and `data:check` operate on the **local Node JSON file**. They do not reset or inspect hosted data. This remains the existing dummy-data demo with its shared PIN and demo-account directory.

References: [OpenNext setup](https://opennext.js.org/cloudflare/get-started), [custom Worker](https://opennext.js.org/cloudflare/howtos/custom-worker), [SQLite Durable Object storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [free Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).
