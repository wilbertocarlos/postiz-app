# WordPress to Postiz

This integration creates an editable Postiz draft whenever a WordPress article
is published for the first time. n8n owns delivery, retries, deduplication, and
notifications; Postiz remains the editorial review and scheduling interface.

## Components

- `wordpress-plugin/mpo-postiz-bridge`: signed first-publish webhook with local retries.
- `n8n/01-create-import-table.json`: idempotent Data Table setup workflow.
- `n8n/02-wordpress-to-postiz.json`: webhook ingestion and 15-minute reconciliation.
- The Postiz fork adds the opt-in LinkedIn `link_preview` setting and native article cards.

## n8n configuration

Use a recent n8n release with Data Tables. Add these environment variables to
the n8n service and restart it:

```text
WORDPRESS_SITE_URL=https://www.example.nl
WORDPRESS_SITE_ID=example-nl
WORDPRESS_POSTIZ_WEBHOOK_SECRET=<64-character random secret>
POSTIZ_LINKEDIN_PAGE_INTEGRATION_ID=<integration UUID from Postiz>
POSTIZ_ALERT_EMAIL=<administrator email address>
NODE_FUNCTION_ALLOW_BUILTIN=crypto
```

Create these credentials in n8n:

1. `Postiz Public API`, type **Header Auth**. Header name: `Authorization`;
   value: a dedicated key from Postiz Settings > Developers > Public API.
2. `Brevo SMTP`, type **SMTP**. Host `smtp-relay.brevo.com`, port `587`, TLS
   upgrade enabled, using a newly generated Brevo SMTP login and key.

Import and run `01-create-import-table.json` once. Then import
`02-wordpress-to-postiz.json`, select the two credentials where requested, test
it, and publish it. Its production webhook ends in
`/webhook/wordpress-postiz-article`.

The workflow polls the last 24 hours of published articles every 15 minutes.
Rows with status `created` are skipped; failed rows are retried. Set production
workflow concurrency to `1` if the installed n8n edition does not retain the
imported concurrency setting.

## WordPress configuration

Zip or upload the `mpo-postiz-bridge` directory as a plugin, activate it, and
open Settings > Postiz Bridge. Enter the production n8n webhook URL, a stable
site ID, and the same webhook secret used by n8n.

The HMAC covers `<unix timestamp>.<raw JSON body>` and is sent in
`X-Postiz-Signature`; signatures older than five minutes are rejected.

## Postiz payload

The workflow calls:

```text
POST https://postiz.multiplusonline.nl/api/public/v1/upload-from-url
POST https://postiz.multiplusonline.nl/api/public/v1/posts
```

Drafts use the next weekday at 10:00 in `Europe/Amsterdam`, retain the canonical
URL, disable URL shortening, and set LinkedIn Page setting `link_preview=true`.
Only a user in Postiz can add supported organization mentions and schedule the
post.

## Release and rollback

Tag the fork with a pinned tag such as `mpo-84edda5.1`. The MPO container
workflow publishes the same immutable tag to GHCR for AMD64 and ARM64. Configure
Coolify with that exact tag, never `latest`. Rollback means restoring the
previous tag and redeploying; no database migration is involved.

`check-mpo-upstream.yml` compares `UPSTREAM_BASE` with upstream Postiz on the
first day of every month. It opens one maintenance issue with the required
regression, release, deployment, and rollback checks when upstream has moved.

Rotate all API, SMTP, OAuth, and webhook credentials that have previously been
shared outside their credential stores before production use.
