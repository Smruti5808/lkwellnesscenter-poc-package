# Commands for future updates

Run these in PowerShell from the repository folder:

```powershell
Set-Location 'D:\SuttlejSoft\POC programs\LK wellness POC\codebase'
npm.cmd ci
npm.cmd run typecheck
npm.cmd test
git status
git add .
git commit -m "Update LK Wellness demo"
git push origin main
npm.cmd run deploy:cloudflare
```

`deploy:cloudflare` prepares a private demo bootstrap, builds Next.js with OpenNext and publishes the Worker on Workers Free. Existing hosted records and uploaded files persist; repeated deployments do not reset them. No R2 commands or payment activation are needed. Review `git status` before staging so the commit includes only your intended changes. Do not use `data:reset` for routine updates.

If Wrangler needs sign-in again:

```powershell
npx.cmd wrangler login
```

Optional local preview:

```powershell
npm.cmd run preview:cloudflare
```

If Cloudflare's Git build is enabled with build command `npm run build:cloudflare` and deploy command `npx wrangler deploy`, pushing `main` triggers deployment. In that case, omit the final manual deploy command and check the build result. Set the Cloudflare root directory to this repository's root (the checkout is already named `codebase`). See [CLOUDFLARE.md](CLOUDFLARE.md) for first deployment and free quotas.
