# EduPay Identity testing strategy

Status: proposed quality baseline
Date: 2026-08-08

Identity testing must prove both successful access and failure containment. A coverage percentage alone is not a release gate.

## Test layers

### Unit tests

Cover deterministic domain and security rules:

- identifier normalization and username/email distinction;
- username uniqueness within a tenant realm;
- optional email behavior;
- membership lifecycle and role assignment;
- activation, invitation, and reset state transitions;
- password policy and hash-parameter upgrade decisions;
- JWT claim construction and omission of tenant context when no membership is active;
- refresh-token rotation, reuse detection, and session revocation;
- rate-limit bucket and lockout behavior;
- safe error mapping that prevents user/tenant enumeration;
- support-context elevation requirements.

### Integration tests

Use a real PostgreSQL-compatible test database and fake Resend/provider adapters to verify:

- unique constraints for username/email rules;
- transactionality of activation and password set;
- atomic refresh-token rotation under concurrent requests;
- token-family revocation after reuse;
- session and membership revocation behavior;
- invitation/activation outbox durability when email delivery fails;
- audit event persistence with no secret values;
- database query scoping by user/membership/tenant;
- idempotency behavior for invite, resend, and activation-challenge requests;
- migration compatibility and rollback evidence.

### Contract tests

Verify the OpenAPI/JWKS/session contracts consumed by EduPay Académico:

- token signature, issuer, audience, expiry, and claim shape;
- active tenant context and membership switching;
- `SYSTEM_ADMIN` behavior without implicit tenant access;
- minimum identity-link lookup response;
- stable error envelope and status codes;
- event schema, versioning, replay key, and idempotency behavior.

No provider contract test should require production Resend credentials.

### API and end-to-end scenarios

At minimum, exercise:

1. Teacher with email receives an invitation, sets a password, logs in, refreshes, and logs out.
2. Student without email receives an administrator handoff code, chooses a password, logs in with institutional username, and cannot reuse the code.
3. One user has memberships in tenants A and B and can switch only through Identity’s membership endpoint.
4. The same username in different tenants cannot be resolved to the wrong tenant.
5. A suspended/revoked membership cannot issue a tenant-context token.
6. A role change invalidates or bounds the staleness of previously issued access.
7. A stolen/replayed refresh token revokes its family and does not mint a session.
8. Password reset revokes active sessions according to policy.
9. Invitation resend is idempotent and prior unused tokens are invalidated according to policy.
10. Academic API accepts a valid Identity token but still rejects unauthorized subject/course/resource access.
11. Existing EduPay admin credentials/cookies are not accepted by Identity and no existing-login behavior changes.

## Security and abuse tests

- credential stuffing simulation with bounded test data;
- per-IP, identifier, tenant, and account/session throttling;
- activation-code guessing and lockout;
- user enumeration through login, recovery, invitation, and membership endpoints;
- token algorithm/key confusion and invalid `kid` handling;
- expired, not-yet-valid, wrong-audience, wrong-issuer, and revoked-session tokens;
- CSRF, XSS, redirect, and cookie attribute checks for browser flows;
- oversized/request-flood inputs and pagination limits;
- audit log redaction assertions;
- service-to-service authentication and replay protection;
- cross-tenant target tampering on every management endpoint.

## Fixtures

Fixtures include at least:

- two tenants with overlapping labels and one repeated institutional username;
- one user with memberships in both tenants and different roles;
- a user without email;
- pending, active, suspended, and revoked memberships;
- expired, consumed, and valid invitations/challenges;
- active, revoked, rotated, and reused refresh-token families;
- disabled users and locked credentials.

Fixtures contain synthetic data only. Tests must never use real student, teacher, email, password, or activation data.

## Release gates

- lint, type/build, schema/migration, and dependency checks;
- unit, integration, contract, API, and end-to-end tests for changed boundaries;
- tenant-context and cross-tenant negative tests;
- secret scanning and audit-redaction checks;
- JWT/JWKS rotation rehearsal;
- refresh reuse and session-revocation evidence;
- invitation and no-email activation failure/retry evidence;
- operational health, backup/restore, incident, and rollback runbooks before production pilot.

