<?php
/**
 * CellTonis Pharma — mail configuration for one.com hosting.
 *
 * Fill in the real values below after uploading to your one.com account.
 * This file only defines constants (it never echoes anything), so even
 * if it were requested directly in a browser it would return a blank
 * page — no secrets are exposed. The included .htaccess also blocks
 * direct requests to it as a second layer of protection.
 *
 * If this repository is public, treat any real SMTP password you put
 * here as sensitive: prefer keeping this file out of version control
 * once configured (e.g. `git rm --cached api/config.php` and add it to
 * .gitignore), and only upload it directly to your hosting.
 */

// Every form submission is delivered here, regardless of which form
// (network application, partner enquiry, general contact) was used.
define('MAIL_TO', 'alfred@celltonispharma.uk');

// Sender identity used in the From header. For best deliverability with
// one.com, this should be a mailbox or alias on a domain hosted in the
// same one.com account, e.g. no-reply@celltonispharma.uk.
define('MAIL_FROM', 'no-reply@celltonispharma.uk');
define('MAIL_FROM_NAME', 'CellTonis Pharma Website');

// Sending method:
//   'mail' — PHP's built-in mail() function, routed through one.com's own
//            mail transport. Zero configuration, works immediately on
//            one.com hosting for most cases. Use this first.
//   'smtp' — authenticated SMTP via one.com's mail servers. Switch to this
//            only if 'mail' proves unreliable (e.g. messages landing in
//            spam) — fill in the SMTP_* settings below and test carefully
//            before relying on it.
define('MAIL_METHOD', 'mail');

// Only read when MAIL_METHOD is 'smtp'. Find these in your one.com control
// panel under the mailbox's settings — the outgoing (SMTP) server details
// for send.one.com are standard for one.com-hosted mailboxes, but confirm
// the exact host/port shown in your own control panel.
define('SMTP_HOST', 'send.one.com');
define('SMTP_PORT', 587);           // 587 = STARTTLS, 465 = implicit TLS
define('SMTP_ENCRYPTION', 'tls');   // 'tls' for port 587, 'ssl' for port 465
define('SMTP_USERNAME', 'no-reply@celltonispharma.uk'); // full mailbox address
define('SMTP_PASSWORD', '');        // the mailbox password — fill in, never commit a real one
