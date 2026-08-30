# WenAppliances security audit

Run the low-impact audit with:

```bash
npm run security:audit
```

You can scan one or more allowlisted deployments:

```bash
npm run security:audit -- --target https://wenappliances.net
npm run security:audit -- --target https://wenappliances.net --target https://wenappliances-admin.vercel.app --json
```

The tool checks HTTPS and HTTP-to-HTTPS redirects, response security headers, wildcard CORS, cookie flags, public source maps, and common accidental exposures such as `.env`, `.git`, package manifests, source folders, and dependency folders. It sends GET requests only, waits between requests, limits response sizes, and accepts only the WenAppliances domains listed in `scripts/security-audit.mjs`.

It does not brute-force accounts, test passwords, inject SQL or scripts, fuzz routes, upload files, change data, or bypass authentication. A high or critical finding makes the command exit with a failure status; medium and low findings are reported for review.
