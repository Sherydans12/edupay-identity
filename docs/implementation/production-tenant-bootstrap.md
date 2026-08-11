# Production tenant-admin bootstrap

Status: operator runbook for the first Identity tenant and tenant administrator

This procedure is a server-side CLI operation. It creates no HTTP endpoint, does not run on application startup, and never creates or accepts a permanent password. Run it only from a built, migrated Identity deployment checkout in the controlled Identity environment against the Identity-owned database.

## Identity command

Choose one canonical UUID independently of tenant names, handles, and source EduPay identifiers. Identity's only tenant metadata field is the normalized login handle, so the command requires the UUID and handle explicitly:

```sh
pnpm bootstrap:tenant-admin -- \
  --tenant-id <canonical-tenant-uuid> \
  --tenant-handle <identity-login-handle> \
  --username <institutional-admin-username> \
  --activation code
```

For email activation, provide an intended email eligible under the normal Identity invitation policy:

```sh
pnpm bootstrap:tenant-admin -- \
  --tenant-id <canonical-tenant-uuid> \
  --tenant-handle <identity-login-handle> \
  --username <institutional-admin-username> \
  --activation email \
  --email <intended-admin-email>
```

Optional `--request-id <operator-request-id>` adds a safe correlation identifier. The command requires `DATABASE_URL` and the normal Identity Argon2/opaque-token configuration. Code mode also uses `IDENTITY_ACTIVATION_TTL_SECONDS`. Email mode additionally requires `IDENTITY_EMAIL_FROM`, `IDENTITY_PUBLIC_BASE_URL`, invitation/outbox settings, and the production outbox encryption key. It queues an encrypted outbox intent; the command never calls Resend directly. The normal separately operated Identity email runner performs delivery.

Code mode prints the activation code exactly once in an explicitly marked sensitive block. Copy it to the approved handoff channel and do not retain the secret in shell transcripts, logs, tickets, or release evidence. Persistence and audit contain only its Argon2 hash and non-secret challenge ID.

Email mode prints only safe queued state and a masked destination. It never prints the invitation token. Preserve only the safe command evidence, then confirm the Identity email runner publishes the queued intent.

## Idempotency and reissue

A compatible rerun returns `already-compatible`, creates no duplicate records, and never reveals or replaces the previous activation secret. Compatibility requires the same canonical UUID, normalized handle, username, activation method/email, active user, pending-or-active membership, and exactly the tenant-scoped `TENANT_ADMIN` role. The bootstrap creates no `SYSTEM_ADMIN` assignment and refuses unexpected platform-role state.

The command refuses conflicting tenant handles/UUIDs, another initial user, a missing or incompatible membership, extra/different roles, a different activation method/email, and inconsistent credential or delivery state. It does not repair those conflicts automatically.

If a still-pending administrator requires a replacement one-time credential, rerun the same command with `--reissue-activation`. Code mode revokes all prior unused challenges and prints the new code once. Email mode revokes prior unused invitations and queues a new encrypted invitation intent. Reissue is refused after activation.

## Coordinated first-pilot procedure

1. Generate or choose one opaque canonical tenant UUID. Do not derive it from the tenant handle, display name, or source EduPay tenant ID.
2. Run `pnpm bootstrap:tenant-admin` in Identity with that UUID. This creates Identity's `TenantRealm`, first `IdentityUser`, pending membership, and exactly `TENANT_ADMIN` in the Identity database.
3. In the separate EduPay Académico deployment, run `pnpm bootstrap:tenant -- --tenant-id <canonical-tenant-uuid>` with the same UUID. Académico creates its independently owned Tenant and storage accounting state in its own database.
4. Deliver the one-time activation code through the approved institutional channel, or operate the Identity email runner so the queued invitation is delivered.
5. The administrator completes the normal Identity activation/invitation flow and chooses their permanent password. The operator never supplies or learns it.
6. The administrator logs in through the normal Identity login flow.
7. Verify the issued tenant context contains the canonical tenant UUID and the initial membership with `TENANT_ADMIN`; verify Académico resolves the same UUID from the validated Identity context.
8. Continue normal authenticated Student and Teacher provisioning. Identity owns their accounts/memberships; Académico retains ownership of academic records and resource policies.

The Identity and Académico databases remain separate throughout. Neither bootstrap reads the other service's database, and the shared UUID is an authenticated integration value rather than a cross-service foreign key.
