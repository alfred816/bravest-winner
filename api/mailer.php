<?php
/**
 * CellTonis Pharma — mail delivery.
 *
 * Two send paths, chosen by MAIL_METHOD in config.php:
 *  - send_via_builtin_mail(): PHP's mail(), no dependencies, no credentials.
 *  - Smtp_Mailer: a small, dependency-free authenticated SMTP client for
 *    when 'mail' isn't reliable enough. No Composer, no third-party
 *    library — just PHP streams, since one.com shared hosting cannot be
 *    assumed to allow Composer installs.
 */

declare(strict_types=1);

/**
 * Strip anything that could be used for header injection. Applied right
 * before any value is placed into a raw email header, regardless of
 * upstream sanitization, as defense in depth.
 */
function sanitize_header_value(string $value): string
{
    $value = preg_replace('/[\r\n]+/', ' ', $value);
    return trim($value ?? '');
}

function build_email_headers_block(string $fromName, string $from, ?string $replyTo): string
{
    $from = sanitize_header_value($from);
    $fromName = sanitize_header_value($fromName);

    $headers = [];
    $headers[] = 'From: ' . $fromName . ' <' . $from . '>';
    if ($replyTo) {
        $replyTo = sanitize_header_value($replyTo);
        $headers[] = 'Reply-To: <' . $replyTo . '>';
    }
    $headers[] = 'MIME-Version: 1.0';
    $headers[] = 'Content-Type: text/plain; charset=UTF-8';
    $headers[] = 'X-Mailer: CellTonis-Website-PHP';

    return implode("\r\n", $headers);
}

function encode_subject(string $subject): string
{
    $subject = sanitize_header_value($subject);
    return '=?UTF-8?B?' . base64_encode($subject) . '?=';
}

/**
 * Send via PHP's built-in mail(). Returns an array with 'ok' (bool) and,
 * when it fails, an 'error' string with whatever PHP itself reported —
 * this is what makes failures debuggable instead of a bare false.
 *
 * Deliberately does NOT pass mail()'s 5th parameter (additional_parameters,
 * used to set a custom envelope sender via -f). Many shared hosts —
 * one.com included — restrict or reject that flag outright for security,
 * which silently makes mail() return false with no indication why. Since
 * MAIL_FROM is already set correctly in the From: header, the envelope
 * sender defaults to the hosting account's own mailbox, which is exactly
 * what a shared host expects and will accept.
 */
function send_via_builtin_mail(string $to, string $subject, string $body, ?string $replyTo, string $from, string $fromName): array
{
    if (!function_exists('mail')) {
        return ['ok' => false, 'error' => 'The PHP mail() function is not available on this server (disabled or missing).'];
    }

    $headers = build_email_headers_block($fromName, $from, $replyTo);
    $encodedSubject = encode_subject($subject);

    error_clear_last();
    $ok = @mail($to, $encodedSubject, $body, $headers);

    if ($ok) {
        return ['ok' => true, 'error' => null];
    }

    $lastError = error_get_last();
    $detail = $lastError ? $lastError['message'] : 'mail() returned false with no further detail from PHP.';

    return ['ok' => false, 'error' => $detail];
}

/**
 * Minimal authenticated SMTP client (STARTTLS or implicit TLS, AUTH LOGIN).
 * Throws SmtpException on any failure so the caller can report a clean
 * error without ever telling the user a submission succeeded when it did
 * not reach the mail server.
 */
class SmtpException extends \RuntimeException
{
}

class Smtp_Mailer
{
    /** @var resource|null */
    private $socket;

    private string $host;
    private int $port;
    private string $username;
    private string $password;
    private string $encryption;

    public function __construct(string $host, int $port, string $username, string $password, string $encryption)
    {
        $this->host = $host;
        $this->port = $port;
        $this->username = $username;
        $this->password = $password;
        $this->encryption = $encryption;
    }

    public function send(string $to, string $from, string $fromName, ?string $replyTo, string $subject, string $body): void
    {
        $this->connect();

        try {
            $this->expect($this->readResponse(), [220]);

            $localName = $_SERVER['SERVER_NAME'] ?? 'localhost';
            $this->command('EHLO ' . $localName, [250]);

            if ($this->encryption === 'tls') {
                $this->command('STARTTLS', [220]);
                if (!stream_socket_enable_crypto($this->socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                    throw new SmtpException('STARTTLS negotiation failed.');
                }
                $this->command('EHLO ' . $localName, [250]);
            }

            $this->command('AUTH LOGIN', [334]);
            $this->command(base64_encode($this->username), [334]);
            $this->command(base64_encode($this->password), [235]);

            $from = sanitize_header_value($from);
            $to = sanitize_header_value($to);

            $this->command('MAIL FROM:<' . $from . '>', [250]);
            $this->command('RCPT TO:<' . $to . '>', [250, 251]);
            $this->command('DATA', [354]);

            $headers = build_email_headers_block($fromName, $from, $replyTo);
            $headers .= "\r\nTo: <" . $to . '>';
            $headers .= "\r\nSubject: " . encode_subject($subject);
            $headers .= "\r\nDate: " . date('r');

            $dotStuffed = preg_replace('/^\./m', '..', $body);
            $message = $headers . "\r\n\r\n" . $dotStuffed . "\r\n.";

            $this->command($message, [250]);
            $this->command('QUIT', [221]);
        } finally {
            $this->disconnect();
        }
    }

    private function connect(): void
    {
        $transport = $this->encryption === 'ssl' ? 'ssl://' : 'tcp://';
        $context = stream_context_create([
            'ssl' => [
                'verify_peer' => true,
                'verify_peer_name' => true,
            ],
        ]);

        $socket = @stream_socket_client(
            $transport . $this->host . ':' . $this->port,
            $errno,
            $errstr,
            15,
            STREAM_CLIENT_CONNECT,
            $context
        );

        if (!$socket) {
            throw new SmtpException('Could not connect to SMTP server: ' . $errstr);
        }

        stream_set_timeout($socket, 15);
        $this->socket = $socket;
    }

    private function disconnect(): void
    {
        if (is_resource($this->socket)) {
            fclose($this->socket);
        }
        $this->socket = null;
    }

    private function readResponse(): string
    {
        $data = '';
        while (($line = fgets($this->socket, 515)) !== false) {
            $data .= $line;
            // A space (not a dash) in the 4th column marks the final line
            // of a multi-line SMTP response.
            if (isset($line[3]) && $line[3] === ' ') {
                break;
            }
        }
        if ($data === '') {
            throw new SmtpException('No response from SMTP server (connection may have timed out).');
        }
        return $data;
    }

    private function command(string $cmd, array $expectedCodes): string
    {
        fwrite($this->socket, $cmd . "\r\n");
        $response = $this->readResponse();
        $this->expect($response, $expectedCodes);
        return $response;
    }

    private function expect(string $response, array $expectedCodes): void
    {
        $code = (int) substr($response, 0, 3);
        if (!in_array($code, $expectedCodes, true)) {
            throw new SmtpException('SMTP server responded: ' . trim($response));
        }
    }
}

/**
 * Send an email using whichever method config.php selects. Returns true
 * on success; throws on hard failure so the caller can distinguish
 * "sent" from "failed" and never show a false success to the user. The
 * exception message always contains the real, specific reason — this is
 * what gets logged (and, while DEBUG_MODE is on, returned to the caller)
 * instead of a generic "something went wrong".
 */
function deliver_email(string $subject, string $body, ?string $replyTo): bool
{
    if (!defined('MAIL_TO') || !filter_var(MAIL_TO, FILTER_VALIDATE_EMAIL)) {
        throw new \RuntimeException('Configuration error: MAIL_TO in api/config.php is missing or not a valid email address.');
    }
    if (!defined('MAIL_FROM') || !filter_var(MAIL_FROM, FILTER_VALIDATE_EMAIL)) {
        throw new \RuntimeException('Configuration error: MAIL_FROM in api/config.php is missing or not a valid email address.');
    }

    if (MAIL_METHOD === 'smtp') {
        if (SMTP_PASSWORD === '') {
            throw new \RuntimeException('Configuration error: MAIL_METHOD is "smtp" but SMTP_PASSWORD in api/config.php is empty.');
        }
        $mailer = new Smtp_Mailer(SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, SMTP_ENCRYPTION);
        $mailer->send(MAIL_TO, MAIL_FROM, MAIL_FROM_NAME, $replyTo, $subject, $body);
        return true;
    }

    $result = send_via_builtin_mail(MAIL_TO, $subject, $body, $replyTo, MAIL_FROM, MAIL_FROM_NAME);
    if (!$result['ok']) {
        throw new \RuntimeException('mail() failed: ' . $result['error']);
    }
    return true;
}
