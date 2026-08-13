<?php
/**
 * Plugin Name: MPO Postiz Bridge
 * Description: Sends newly published articles to the editorial n8n workflow.
 * Version: 1.0.0
 * Requires at least: 6.2
 * Requires PHP: 8.0
 * Author: Multiplus Online
 */

if (!defined('ABSPATH')) {
    exit;
}

const MPO_POSTIZ_OPTION = 'mpo_postiz_bridge';
const MPO_POSTIZ_SENT_META = '_mpo_postiz_dispatched_at';
const MPO_POSTIZ_RETRY_META = '_mpo_postiz_retry_attempt';

register_activation_hook(__FILE__, static function (): void {
    $settings = get_option(MPO_POSTIZ_OPTION, []);
    if (empty($settings['secret'])) {
        $settings['secret'] = wp_generate_password(64, false, false);
    }
    if (empty($settings['site_id'])) {
        $settings['site_id'] = (string) wp_parse_url(home_url('/'), PHP_URL_HOST);
    }
    update_option(MPO_POSTIZ_OPTION, $settings, false);
});

add_action('transition_post_status', static function ($new_status, $old_status, $post): void {
    if (
        'publish' !== $new_status ||
        'publish' === $old_status ||
        'post' !== $post->post_type ||
        wp_is_post_revision($post->ID) ||
        get_post_meta($post->ID, MPO_POSTIZ_SENT_META, true)
    ) {
        return;
    }

    if (!wp_next_scheduled('mpo_postiz_dispatch_article', [$post->ID, 0])) {
        wp_schedule_single_event(time() + 5, 'mpo_postiz_dispatch_article', [$post->ID, 0]);
    }
}, 10, 3);

add_action('mpo_postiz_dispatch_article', static function ($post_id, $attempt): void {
    $post_id = absint($post_id);
    $attempt = absint($attempt);
    $post = get_post($post_id);
    $settings = get_option(MPO_POSTIZ_OPTION, []);

    if (
        !$post ||
        'post' !== $post->post_type ||
        'publish' !== $post->post_status ||
        get_post_meta($post_id, MPO_POSTIZ_SENT_META, true) ||
        empty($settings['webhook_url']) ||
        empty($settings['secret'])
    ) {
        return;
    }

    $excerpt = has_excerpt($post)
        ? get_the_excerpt($post)
        : wp_trim_words(wp_strip_all_tags(strip_shortcodes($post->post_content)), 55, '');
    $payload = [
        'site_id' => sanitize_key($settings['site_id'] ?? ''),
        'post_id' => $post_id,
        'canonical_url' => get_permalink($post),
        'title' => html_entity_decode(get_the_title($post), ENT_QUOTES | ENT_HTML5, 'UTF-8'),
        'excerpt' => html_entity_decode(wp_strip_all_tags($excerpt), ENT_QUOTES | ENT_HTML5, 'UTF-8'),
        'featured_image_url' => get_the_post_thumbnail_url($post, 'full') ?: '',
        'published_at' => get_post_time(DATE_ATOM, false, $post),
    ];
    $body = wp_json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    $timestamp = (string) time();
    $signature = 'sha256=' . hash_hmac('sha256', $timestamp . '.' . $body, $settings['secret']);

    $response = wp_remote_post($settings['webhook_url'], [
        'timeout' => 15,
        'redirection' => 0,
        'headers' => [
            'Content-Type' => 'application/json',
            'User-Agent' => 'MPO-Postiz-Bridge/1.0',
            'X-Postiz-Timestamp' => $timestamp,
            'X-Postiz-Signature' => $signature,
            'X-Postiz-Event-ID' => $payload['site_id'] . ':' . $post_id,
        ],
        'body' => $body,
        'data_format' => 'body',
    ]);

    $status = is_wp_error($response) ? 0 : wp_remote_retrieve_response_code($response);
    if ($status >= 200 && $status < 300) {
        update_post_meta($post_id, MPO_POSTIZ_SENT_META, gmdate(DATE_ATOM));
        delete_post_meta($post_id, MPO_POSTIZ_RETRY_META);
        return;
    }

    update_post_meta($post_id, MPO_POSTIZ_RETRY_META, $attempt + 1);
    $retry_delays = [60, 300, 900];
    if (isset($retry_delays[$attempt])) {
        wp_schedule_single_event(
            time() + $retry_delays[$attempt],
            'mpo_postiz_dispatch_article',
            [$post_id, $attempt + 1]
        );
    }
}, 10, 2);

add_action('admin_init', static function (): void {
    register_setting('mpo_postiz_bridge', MPO_POSTIZ_OPTION, [
        'type' => 'array',
        'sanitize_callback' => static function ($input): array {
            $current = get_option(MPO_POSTIZ_OPTION, []);
            $secret = trim((string) ($input['secret'] ?? ''));
            return [
                'webhook_url' => esc_url_raw($input['webhook_url'] ?? ''),
                'site_id' => sanitize_key($input['site_id'] ?? ''),
                'secret' => $secret ?: ($current['secret'] ?? ''),
            ];
        },
    ]);
});

add_action('admin_menu', static function (): void {
    add_options_page(
        'Postiz Bridge',
        'Postiz Bridge',
        'manage_options',
        'mpo-postiz-bridge',
        static function (): void {
            $settings = get_option(MPO_POSTIZ_OPTION, []);
            ?>
            <div class="wrap">
                <h1>Postiz Bridge</h1>
                <form method="post" action="options.php">
                    <?php settings_fields('mpo_postiz_bridge'); ?>
                    <table class="form-table" role="presentation">
                        <tr>
                            <th scope="row"><label for="mpo-webhook-url">n8n webhook URL</label></th>
                            <td><input class="regular-text" id="mpo-webhook-url" type="url" required name="<?php echo esc_attr(MPO_POSTIZ_OPTION); ?>[webhook_url]" value="<?php echo esc_attr($settings['webhook_url'] ?? ''); ?>"></td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="mpo-site-id">Site ID</label></th>
                            <td><input class="regular-text" id="mpo-site-id" type="text" required name="<?php echo esc_attr(MPO_POSTIZ_OPTION); ?>[site_id]" value="<?php echo esc_attr($settings['site_id'] ?? ''); ?>"></td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="mpo-secret">Webhook secret</label></th>
                            <td><input class="regular-text" id="mpo-secret" type="password" autocomplete="new-password" name="<?php echo esc_attr(MPO_POSTIZ_OPTION); ?>[secret]" placeholder="Ongewijzigd laten"></td>
                        </tr>
                    </table>
                    <?php submit_button(); ?>
                </form>
            </div>
            <?php
        }
    );
});
