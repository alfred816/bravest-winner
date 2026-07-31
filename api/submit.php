<?php
/**
 * CellTonis Pharma — form submission handler for one.com PHP hosting.
 *
 * Handles all three website forms (network application, distribution
 * partner enquiry, general contact). No frameworks, no Composer, no
 * external services beyond one.com's own mail transport — this is a
 * single file that runs as-is on standard Apache + PHP shared hosting.
 *
 * Required setup: fill in api/config.php with your real MAIL_TO /
 * MAIL_FROM (and SMTP_* if you switch MAIL_METHOD to 'smtp').
 */

declare(strict_types=1);

// Never let a PHP warning/notice leak into what should be a clean JSON
// response, or show internals to a visitor. Failures are still recorded
// via error_log() further down.
ini_set('display_errors', '0');
error_reporting(E_ALL);

header('Content-Type: application/json; charset=utf-8');

require __DIR__ . '/config.php';
require __DIR__ . '/mailer.php';

function respond(int $statusCode, array $payload): void
{
    http_response_code($statusCode);
    echo json_encode($payload);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    respond(405, ['ok' => false, 'error' => 'Method not allowed.']);
}

// The frontend sends JSON; fall back to classic form-encoded data if a
// request ever arrives that way.
$raw = file_get_contents('php://input');
$body = json_decode((string) $raw, true);
if (!is_array($body)) {
    $body = $_POST;
}

function clean_field($value, int $maxLength = 300, bool $multiline = false): string
{
    if (!is_string($value)) {
        return '';
    }

    $v = trim($value);

    // Strip control characters. Multiline fields keep real newlines;
    // single-line fields collapse any line breaks to spaces (these values
    // may end up in email headers, so newlines must never survive here).
    if ($multiline) {
        $v = preg_replace('/\r\n?/', "\n", $v);
        $v = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', (string) $v);
    } else {
        $v = preg_replace('/[\x00-\x1F\x7F]+/', ' ', $v);
        $v = trim(preg_replace('/\s+/', ' ', (string) $v));
    }

    if (function_exists('mb_substr')) {
        $v = mb_substr((string) $v, 0, $maxLength);
    } else {
        $v = substr((string) $v, 0, $maxLength);
    }

    return (string) $v;
}

function is_valid_email(string $value): bool
{
    return strlen($value) <= 254 && filter_var($value, FILTER_VALIDATE_EMAIL) !== false;
}

function get_client_ip(): string
{
    $forwarded = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
    if (is_string($forwarded) && $forwarded !== '') {
        $parts = explode(',', $forwarded);
        $ip = trim($parts[0]);
        if ($ip !== '') {
            return $ip;
        }
    }
    return $_SERVER['REMOTE_ADDR'] ?? 'unknown';
}

/**
 * Best-effort per-IP rate limit backed by a small JSON file per IP, since
 * shared PHP hosting has no persistent in-process memory between requests.
 * Fails open (does not block) if the storage directory isn't writable,
 * rather than silently breaking legitimate submissions.
 */
function is_rate_limited(string $ip): bool
{
    $windowSeconds = 600; // 10 minutes
    $maxRequests = 5;

    $dir = __DIR__ . '/ratelimit';
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }
    if (!is_dir($dir) || !is_writable($dir)) {
        return false;
    }

    $safeKey = preg_replace('/[^a-zA-Z0-9_.:-]/', '_', $ip);
    $file = $dir . '/' . $safeKey . '.json';

    $fp = @fopen($file, 'c+');
    if (!$fp) {
        return false;
    }

    flock($fp, LOCK_EX);
    $contents = stream_get_contents($fp);
    $timestamps = json_decode($contents !== false ? $contents : '[]', true);
    if (!is_array($timestamps)) {
        $timestamps = [];
    }

    $now = time();
    $timestamps = array_values(array_filter($timestamps, function ($t) use ($now, $windowSeconds) {
        return is_numeric($t) && ($now - (int) $t) < $windowSeconds;
    }));
    $timestamps[] = $now;

    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($timestamps));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);

    return count($timestamps) > $maxRequests;
}

// ---------------------------------------------------------------------
// Field definitions per form type
// ---------------------------------------------------------------------

$FORM_CONFIG = [
    'network-application' => [
        'title' => 'CELLTONIS PHARMA — NEW NETWORK APPLICATION',
        'fields' => [
            ['key' => 'fullName', 'label' => 'Name', 'required' => true],
            ['key' => 'businessName', 'label' => 'Business', 'required' => true],
            ['key' => 'role', 'label' => 'Role', 'required' => false],
            ['key' => 'email', 'label' => 'Email', 'required' => true, 'type' => 'email'],
            ['key' => 'phone', 'label' => 'Phone', 'required' => true],
            ['key' => 'country', 'label' => 'Country', 'required' => true],
            ['key' => 'city', 'label' => 'City', 'required' => false],
            ['key' => 'businessType', 'label' => 'Business Type', 'required' => true],
            ['key' => 'interests', 'label' => 'Interest', 'required' => true, 'isArray' => true],
            ['key' => 'monthlyVolume', 'label' => 'Monthly Purchasing Requirement', 'required' => false],
            ['key' => 'products', 'label' => 'Products', 'required' => false],
            ['key' => 'message', 'label' => 'Additional Information', 'required' => false, 'multiline' => true],
        ],
        'subject' => function (array $v): string {
            return 'New CellTonis Network Application — ' . $v['businessName'];
        },
        'enquiryLabel' => 'Network Application',
    ],
    'partner-enquiry' => [
        'title' => 'CELLTONIS PHARMA — NEW DISTRIBUTION PARTNER ENQUIRY',
        'fields' => [
            ['key' => 'fullName', 'label' => 'Name', 'required' => true],
            ['key' => 'company', 'label' => 'Company', 'required' => true],
            ['key' => 'role', 'label' => 'Role', 'required' => false],
            ['key' => 'email', 'label' => 'Email', 'required' => true, 'type' => 'email'],
            ['key' => 'phone', 'label' => 'Phone', 'required' => true],
            ['key' => 'country', 'label' => 'Country', 'required' => true],
            ['key' => 'businessType', 'label' => 'Business Type', 'required' => true],
            ['key' => 'currentMarkets', 'label' => 'Current Markets', 'required' => false],
            ['key' => 'productInterest', 'label' => 'Product Interest', 'required' => false],
            ['key' => 'message', 'label' => 'Additional Information', 'required' => false, 'multiline' => true],
        ],
        'subject' => function (array $v): string {
            return 'New CellTonis Website Enquiry — Distribution Partner (' . $v['company'] . ')';
        },
        'enquiryLabel' => 'Distribution Partner Enquiry',
    ],
    'general-contact' => [
        'title' => 'CELLTONIS PHARMA — NEW WEBSITE ENQUIRY',
        'fields' => [
            ['key' => 'name', 'label' => 'Name', 'required' => true],
            ['key' => 'company', 'label' => 'Company', 'required' => false],
            ['key' => 'email', 'label' => 'Email', 'required' => true, 'type' => 'email'],
            ['key' => 'enquiryType', 'label' => 'Enquiry Type', 'required' => true],
            ['key' => 'message', 'label' => 'Message', 'required' => true, 'multiline' => true],
        ],
        'subject' => function (array $v): string {
            return 'New CellTonis Website Enquiry — ' . ($v['enquiryType'] !== '' ? $v['enquiryType'] : 'General');
        },
        'enquiryLabel' => null, // uses the submitted enquiryType instead
    ],
];

// ---------------------------------------------------------------------
// Handle the request
// ---------------------------------------------------------------------

// Honeypot — bots that fill every field trip this; real users never see it.
if (clean_field($body['website'] ?? '', 100) !== '') {
    respond(200, ['ok' => true]);
}

$formType = clean_field($body['formType'] ?? '', 40);
if (!isset($FORM_CONFIG[$formType])) {
    respond(400, ['ok' => false, 'error' => 'Invalid form type.']);
}

$ip = get_client_ip();
if (is_rate_limited($ip)) {
    respond(429, ['ok' => false, 'error' => 'Too many submissions. Please try again in a few minutes.']);
}

$config = $FORM_CONFIG[$formType];
$values = [];
$missing = [];

foreach ($config['fields'] as $def) {
    $key = $def['key'];

    if (!empty($def['isArray'])) {
        $rawArray = isset($body[$key]) && is_array($body[$key]) ? $body[$key] : [];
        $cleanArray = [];
        foreach (array_slice($rawArray, 0, 10) as $item) {
            $cleanedItem = clean_field(is_string($item) ? $item : '', 80);
            if ($cleanedItem !== '') {
                $cleanArray[] = $cleanedItem;
            }
        }
        $values[$key] = $cleanArray;
        if (!empty($def['required']) && count($cleanArray) === 0) {
            $missing[] = $def['label'];
        }
        continue;
    }

    $maxLength = !empty($def['multiline']) ? 4000 : 300;
    $cleaned = clean_field($body[$key] ?? '', $maxLength, !empty($def['multiline']));
    $values[$key] = $cleaned;

    if (!empty($def['required']) && $cleaned === '') {
        $missing[] = $def['label'];
    }
    if (($def['type'] ?? '') === 'email' && $cleaned !== '' && !is_valid_email($cleaned)) {
        $missing[] = $def['label'] . ' (invalid format)';
    }
}

if (count($missing) > 0) {
    respond(400, ['ok' => false, 'error' => 'Please check: ' . implode(', ', $missing)]);
}

$submittedAt = gmdate('Y-m-d H:i:s') . ' UTC';
$enquiryLabel = $config['enquiryLabel'] ?? ($values['enquiryType'] ?? 'General Enquiry');

$lines = [$config['title'], '', 'Submitted: ' . $submittedAt, 'Enquiry type: ' . $enquiryLabel, ''];
foreach ($config['fields'] as $def) {
    $v = !empty($def['isArray']) ? implode(', ', $values[$def['key']]) : $values[$def['key']];
    $lines[] = $def['label'] . ': ' . ($v !== '' ? $v : '—');
}
$emailBody = implode("\n", $lines);

$subject = ($config['subject'])($values);
$replyToEmail = isset($values['email']) && is_valid_email($values['email']) ? $values['email'] : null;

try {
    deliver_email($subject, $emailBody, $replyToEmail);
    respond(200, ['ok' => true]);
} catch (\Throwable $e) {
    error_log('CellTonis form submission failed: ' . $e->getMessage());

    $errorPayload = ['ok' => false, 'error' => 'We could not send your submission. Please try again shortly.'];
    if (defined('DEBUG_MODE') && DEBUG_MODE) {
        // Visible only in the raw HTTP response (e.g. browser devtools'
        // Network tab) — the on-screen message above is unchanged.
        $errorPayload['debug'] = $e->getMessage();
    }
    respond(502, $errorPayload);
}
