=== MPO Postiz Bridge ===
Contributors: multiplusonline
Requires at least: 6.2
Requires PHP: 8.0
Stable tag: 1.0.0
License: GPLv2 or later

Sends newly published WordPress articles to an HMAC-protected n8n webhook.

== Installation ==

1. Upload and activate the plugin.
2. Open Settings > Postiz Bridge.
3. Enter the production n8n webhook URL and a shared secret.
4. Keep the same secret in the n8n credential/configuration.

The plugin only sends the first transition to publish. Failed deliveries are
retried after 1, 5, and 15 minutes; the n8n reconciliation workflow is the
final recovery mechanism.
