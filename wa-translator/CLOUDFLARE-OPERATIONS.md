# Lingua Relay Cloudflare release operations

This runbook covers the Worker deployment boundary before Apple/Google store accounts exist. Store signing and store-console acceptance remain separate later gates.

## Environment contract

Lingua Relay has three deliberately distinct Worker configurations:

- local development: `spoken-translation-room-dev`, loopback only;
- staging: `spoken-translation-room-staging`;
- production: `spoken-translation-room`.

Staging and production use separate Worker/Durable Object namespaces. Both ship through `src/session-issuance-entry.ts`, upload source maps, keep Workers Logs enabled, and keep automatic invocation URL logging disabled because room URLs are bearer capabilities.

## Required GitHub environments

Create these GitHub environments before attempting cloud deployment:

- `cloudflare-staging`
- `cloudflare-production`

Each environment needs only the Cloudflare credentials used by Wrangler:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Use environment protection/reviewers for production. Do not store these values in repository variables or Wrangler `vars`.

## Staging promotion

Staging is manual-only and exact-SHA-bound.

```powershell
gh workflow run cloudflare-staging.yml --repo javin23863/lang --ref prelaunch/productization-2026 -f release_sha=<EXACT_40_CHAR_SHA>
```

A successful staging run must show all of the following before production is considered:

1. exact dispatch SHA equals the requested SHA;
2. the complete repository check passes;
3. Wrangler deploys only `wrangler.staging.jsonc`;
4. the live smoke verifies health, protocol 2, session account mode, foreground call lifecycle, two-person room contract, dashboard security headers, and public legal/deletion surfaces.

## Production promotion

Production is a separate manual workflow and requires an explicit confirmation phrase in addition to the exact SHA.

```powershell
gh workflow run cloudflare-production.yml --repo javin23863/lang --ref prelaunch/productization-2026 -f release_sha=<EXACT_40_CHAR_SHA> -f confirm=DEPLOY_PRODUCTION
```

Do not use a moving branch name as the release receipt. Record the exact SHA and the Worker deployment/version information printed by the workflow.

The workflow runs the same credential-free repository checks before it is allowed to deploy, then smoke-tests the live production origin immediately afterward.

## Find rollback targets

Wrangler tracks deployed Worker versions. With production credentials available, list recent versions and deployments from `wa-translator/cloudflare`:

```powershell
npx wrangler versions list --name spoken-translation-room --json
npx wrangler deployments list --name spoken-translation-room
```

Record the version ID of the last known-good deployment as part of every production release receipt.

## Production rollback

Cloudflare rollback immediately creates a deployment of the selected previous Worker version. Use the repository workflow so the action is review-gated and followed by the same live smoke contract.

```powershell
gh workflow run cloudflare-production-rollback.yml --repo javin23863/lang -f version_id=<CLOUDFLARE_VERSION_ID> -f confirm=ROLLBACK_PRODUCTION
```

Do not roll back blindly across a Durable Object class lifecycle or binding migration. Cloudflare can reject such a rollback when resource/binding shape has changed, and even a technically accepted old version may be incompatible with newer stored data. Review the migration history first.

If the automated smoke fails after a deployment or rollback, treat production as unhealthy even if Wrangler itself returned success.

## Incident receipt

For each production incident or release, retain:

- exact source SHA;
- GitHub workflow run ID;
- Worker deployment/version ID;
- operation (`deploy` or `rollback`);
- live-smoke result;
- UTC timestamp;
- operator/reviewer;
- short reason for rollback if applicable.

Do not place room URLs, room tokens, Authorization headers, account identifiers, names, message/caption text, transcripts, or provider secrets in incident notes.
