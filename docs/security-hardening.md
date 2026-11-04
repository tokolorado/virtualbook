# Security hardening

This change updates Next.js and its ESLint configuration to 16.4.5, refreshes the
dependency lockfile, removes the vulnerable PostCSS override, and selects a fixed
Zod version used by the development tooling.

The retired `/api/auth/check-email` route always returns a non-cacheable 410. It
does not read email addresses, load privileged Supabase credentials, or enumerate
users. Login, signup, confirmation resend and password reset no longer call the
route. Their UI responses avoid disclosing account existence. Supabase Auth still
provides the public authentication API; production email confirmation, rate
limits and abuse protection must be enabled and verified there too.

Security headers deny framing and MIME sniffing, restrict the referrer, and
disable camera, microphone and geolocation access. These do not replace an
application-specific Content Security Policy or deployment configuration review.

The settlement cron now checks its secret before creating any database log entry,
so anonymous requests cannot trigger privileged logging writes.

## Automated checks

- `npm test`: includes account-discovery regression coverage.
- `npm run build`: production compilation and TypeScript checks.
- `node scripts/security-smoke.mjs`: HTTP checks against a local production server
  on port 3210. Use build-only Supabase placeholders and a dummy `CRON_SECRET`;
  never point this smoke test at production.
- CI installs with `npm ci --ignore-scripts`, blocks on high/critical dependency
  advisories, unit tests, production build and HTTP checks. It uses no production
  credentials. The existing cron workflows retain their configured secrets.
- Weekly Dependabot checks cover npm and GitHub Actions. CodeQL scans JavaScript
  and TypeScript on pull requests, main updates and a weekly schedule.
- Actions are pinned to full SHAs, checkout does not persist credentials in CI,
  and workflow permissions and execution time are restricted.

## Verified locally on 2026-11-04

- 38 unit/regression tests passed; production build passed with fake Supabase
  configuration. These checks do not exercise real email delivery or the live DB.
- `npm audit --omit=dev`: zero reported vulnerabilities.
- Full audit: no high/critical advisories; one remaining moderate advisory,
  GHSA-g3hv-75wg-m249, in development-only `minimatch`. npm counts 16 affected
  packages through this dependency. Existing ESLint plugins require the legacy
  callable minimatch API, while the patched major has a different API. npm's
  suggested force fix downgrades ESLint to 4.0.0. Neither an unsupported override
  nor that downgrade is applied. A compatible lint-toolchain migration remains
  open. This finding is not suppressed in audit output.
- Full lint has 124 errors and 9 warnings; the unmodified main source with the
  same installed tooling produces the same totals. These include 95 existing
  `no-explicit-any` errors and existing React hook violations. CI reports lint
  visibly as non-blocking debt; the lint rules themselves are unchanged. Fix this
  debt and make the lint step blocking after the baseline passes.
- A limited pattern scan of 900 historical Git blobs found no common GitHub/AWS
  token, JWT or private-key patterns, and no `.env`/private-key file paths. This
  is not a substitute for a complete secret-scanning service or credential audit.

## Repository and deployment checks still requiring access

The available GitHub integration reports the owner's admin role but returns 403
for branch protection, Actions permissions, Dependabot alerts, secret-scanning
alerts and CodeQL default-setup settings. Workflow files cannot confirm or change
those controls by themselves.

Verify in the authenticated repository settings:

1. Require pull requests and passing `Verify security fixes` on main, in addition
   to the existing deletion/force-push protection. Verify the workflow has run
   successfully before requiring its status.
2. Enable dependency alerts/security updates and secret scanning/push protection;
   inspect any real alerts without copying secrets into issues or documentation.
3. Confirm Actions tokens default to read-only, workflow approval is required for
   outside contributors, and collaborators/apps/webhooks/deploy keys are intended.
4. Confirm the CodeQL workflow publishes results. If default setup is already
   active, choose one setup method before enabling the custom workflow.

No deployment or Supabase settings are changed by this patch. Before declaring
the live application secured, deploy the reviewed fixes and verify the deployed
version, email confirmation, Auth rate limits/CAPTCHA, redirect allowlists, applied
RLS policies/function grants, and the deployment's secrets and access controls.
Disconnecting Vercel from GitHub does not stop an existing deployment. Do not
reconnect it or rotate/revoke credentials without checking which services use them.
