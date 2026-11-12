# Password-recovery email previews

These files are synthetic previews of `createPasswordRecoveryEmail`:

- [`password-recovery-email-es.html`](password-recovery-email-es.html) — HTML layout; open locally in a browser.
- [`password-recovery-email-es.txt`](password-recovery-email-es.txt) — text alternative.

The recipient, token, and link are synthetic. No email was sent while preparing these previews. Production rendering reads the configured `IDENTITY_PASSWORD_RESET_TTL_SECONDS` and the existing authorized account UI base URL at message-creation time.
