# Operator email correction

Status: operator runbook for correcting an existing active Identity account

This operation is intentionally a private, server-side CLI command. It is not an unauthenticated API or a general user-facing email-change flow. It exists for a controlled Identity operator who has independently confirmed the account and replacement address. Run it only from the private Identity deployment environment against the Identity-owned PostgreSQL database; never run it from a developer workstation against production and never edit production SQL directly.

## Command

```sh
pnpm operator:correct-email -- \
  --tenant-id <canonical-tenant-uuid> \
  --username <existing-username> \
  --email <replacement-email> \
  --request-id <safe-operator-correlation-id>
```

`--request-id` is optional. The command normalizes the tenant UUID, username, and email using the existing Identity identifier rules. The tenant UUID plus tenant-scoped username must resolve to exactly one active Identity user with one active membership. The command preserves that membership, username, and every existing role.

The replacement email is explicitly marked verified by this operator-owned correction. This is the smallest policy compatible with the existing recovery flow: normal password recovery sends only to a verified email. After the correction, the account owner requests and completes the normal password reset link at the corrected address. The operator never creates, receives, or learns the new password, and this command does not create a second reset mechanism.

## Safety and idempotency

- A replacement email already belonging to another Identity user is refused.
- The operation is one serializable transaction and changes only the email identifier plus required security state.
- Every active session and its refresh tokens are revoked with reason `EMAIL_CORRECTION`.
- Still-valid outstanding password-reset tokens are revoked.
- Unused invitations and activation challenges for the membership are revoked. Pending invitation email intents are marked terminally failed so a revoked invitation is not delivered later.
- A successful correction appends the non-secret `OPERATOR_EMAIL_CORRECTED` audit event with the request ID and safe counts. The raw email and all secrets are excluded from audit metadata and CLI output; the destination is masked.
- Re-running the command after the account is compatible returns `already-compatible` and performs no additional mutation.
- Conflicting, inactive, missing, cross-tenant, or ambiguous state is refused rather than repaired automatically.

The command emits only structured safe evidence: status, Identity user and membership IDs, canonical tenant ID, normalized username, masked destination, revocation counts, and request ID.
