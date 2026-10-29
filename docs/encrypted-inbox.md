# Encrypted customer support inbox

This page documents the original anonymous intake and administrator recovery flow. Registered customers now use [two-way conversations with automatic sign-in sync](customer-experience.md); they do not need recovery files or an extra passphrase.

## Administrator setup and recovery

Open **Admin → Inbox**. Create a strong recovery passphrase that is different from the sign-in password. The browser generates a recipient key pair; download its password-protected recovery file, then activate the inbox. Activation publishes only the public key. The server never receives the recovery passphrase, private JWK, decrypted message, sender name or sender email from the official contact form.

Keep the recovery file and its passphrase in a secure backup process. An optional remembered copy stores only the encrypted recovery file in that browser’s local storage. The passphrase is never remembered. Import the downloaded file and enter the passphrase to unlock on another device. Private `CryptoKey` objects are non-extractable after import and held only in the mounted inbox component; locking, leaving the page or signing out discards the active private-key reference and decrypted view.

An account-password reset cannot recover inbox messages. Losing both the recovery file and all remembered encrypted copies, or losing its passphrase, makes that key’s messages unreadable. Download again while the encrypted backup is still available. Key rotation affects future messages; retain older recovery files for older messages. The UI selects the corresponding key when an older message is opened. Rotation uses a revision/active-key check to prevent concurrent administrators from silently replacing each other’s setup.

## Customer and administrator workflow

Customers open **Contact us**, enter name, email, subject, message and optional order reference, and submit without needing an account. All these fields are encrypted in the browser before the API request. If the inbox has no active recipient key or the browser cannot use secure-context cryptography, sending is disabled rather than falling back to plaintext.

The authenticated admin inbox lists message references, dates and read/resolved status. Those metadata fields and unread counts are not encrypted. Contents appear only after local decryption with the matching recovery key. Read/resolved actions and deletion are authenticated/audited. Deletion removes the encrypted message; it does not delete a recovery key needed by other messages. Message contents are rendered as text, never injected as HTML.

Unread badges and in-app alerts poll while the admin app is visible, every 30 seconds, and refresh on focus or inbox actions. No plaintext email/SMS notification or automatic email forwarding is performed: delivery to the encrypted admin inbox is the forwarding mechanism. The current protocol is one-way support intake, not an encrypted reply/chat protocol. Message retention is until administrator deletion; there is no implicit retention deadline or content-search index.

## Cryptographic format and trust boundary

Each message uses a fresh AES-256-GCM key and 96-bit random nonce with a 128-bit authentication tag. RSA-OAEP-3072 with SHA-256 encrypts the AES key for the recipient. Authenticated additional data binds protocol version, recipient key ID and random message ID. A changed ciphertext or substituted message ID fails decryption. Envelopes are size/version validated; the API cannot inspect or validate their decrypted content. Identical-envelope retries are idempotent and never reset a message’s read status.

Recovery files encrypt the private JWK with AES-256-GCM using a separate 128-bit random salt, 96-bit nonce and a key derived from the passphrase with PBKDF2-HMAC-SHA256, 600,000 iterations. The versioned file records its KDF/work factor; backup authentication binds key ID and public-key fingerprint. A wrong passphrase or modified backup fails authentication. Public fingerprints are SHA-256 of SPKI public-key bytes and are displayed for independent comparison.

This provides client-to-admin content confidentiality under trusted browser code and an authentic recipient key. HTTPS and a trusted origin are still required. Like other browser-delivered cryptography, it does not protect against compromised served JavaScript, malicious browser extensions, a stolen unlocked device, or public-key substitution without independent fingerprint verification. Administrators can verify fingerprints through a separate trusted channel. Long-lived RSA recipient keys do **not** provide forward secrecy: compromise of a recipient private key can expose older envelopes for that key. This implementation has automated cryptographic and browser tests, not an independent security audit or certification.
