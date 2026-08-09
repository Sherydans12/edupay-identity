# EduPay Identity API contracts

Status: approved REST/JSON integration contract baseline
Date: 2026-08-08
Accepted: 2026-08-08

The contract follows the Académico baseline convention: versioned REST/JSON under `/api/v1`, opaque IDs, boundary validation, explicit errors, correlation IDs, and OpenAPI documentation. JSON names are camelCase.

The `tenantId` carried in an Identity tenant context is the canonical ecosystem tenant identifier. It is the same stable logical identifier used by the corresponding Académico tenant record. Each service persists its own tenant record and database; no cross-service foreign key or direct table access exists. Authenticated JWT, API, and event contracts are the only exchange paths for this identifier.

## Common rules

- `Authorization: Bearer <accessToken>` is required for authenticated endpoints.
- `X-Request-Id` is accepted or generated at the edge and returned in responses.
- A URL or body `tenantId` identifies a target resource only; it never grants tenant authorization. The server compares it with the trusted Identity context and rejects or ignores a conflict according to the endpoint contract.
- Management endpoints require an active membership context or explicit system-admin support context.
- High-risk management and academic-linking operations may require an online current-session or current-membership validation even when the access JWT is otherwise valid.
- Mutation endpoints that create invitations, activation challenges, or sessions are idempotent where a client retry could duplicate state.
- Error responses use a stable envelope:

```json
{
  "error": {
    "code": "AUTHENTICATION_FAILED",
    "message": "The credentials could not be verified.",
    "details": [],
    "requestId": "req_01J..."
  }
}
```

Messages are safe for users. Secret values, internal SQL details, account-existence clues, and cross-tenant data are excluded.

## Authentication endpoints

### `POST /api/v1/auth/login`

Request:

```json
{
  "tenantHandle": "colegio-conquistadores",
  "identifier": "matias.gonzalez",
  "password": "user-entered-secret",
  "device": { "label": "Chrome on Windows" }
}
```

`tenantHandle` is optional when the identifier is globally unambiguous and is only a realm-selection hint. It is not placed into authorization context until Identity verifies the password and membership.

Success returns an access token, refresh token/cookie, session ID, and selected membership context. If multiple active memberships remain after credential verification, return `MEMBERSHIP_SELECTION_REQUIRED` with a bounded list of safe tenant display values and opaque membership IDs.

### `POST /api/v1/auth/refresh`

Consumes one refresh token and returns a new access token plus replacement refresh token. Reuse of an already-used token returns `REFRESH_REUSE_DETECTED`, revokes the family, and requires login.

### `POST /api/v1/auth/logout`

Revokes the current session. The endpoint is safe to retry.

### `POST /api/v1/auth/logout-all`

Revokes all sessions for the authenticated user. Requires reauthentication or an approved recent-authentication policy for sensitive clients.

### `GET /api/v1/auth/me`

Returns the minimum authenticated profile and current session context. It does not return credentials or tokens beyond the current access context.

### `GET /api/v1/auth/memberships`

Returns active memberships for the authenticated user, including opaque membership IDs, safe tenant display name/handle, status, and roles. It does not reveal memberships for other users.

### `POST /api/v1/auth/sessions/current-context`

Request:

```json
{ "membershipId": "mem_01J..." }
```

Identity verifies ownership and active status, updates the session’s active context, and issues a new access token. A caller cannot select a membership that is not theirs, even if it supplies another tenant ID.

### `POST /api/v1/auth/password-recovery/request`

Accepts an identifier and optional tenant handle. Always returns a generic accepted response. A reset message is sent only to an eligible verified email.

### `POST /api/v1/auth/password-recovery/confirm`

Consumes a one-time reset token and a new password. Revokes sessions as required by policy.

### `POST /api/v1/auth/invitations/accept`

Consumes an email invitation token and a new password. The token binds the operation to one pending membership; the request cannot choose a different tenant or role.

### `POST /api/v1/auth/activations/complete`

Consumes a no-email activation challenge, institutional username, and new password. The challenge resolves the membership server-side; a client-supplied tenant ID is not accepted as proof.

## Membership management endpoints

These endpoints are intended for EduPay Académico’s backend adapter or an Identity administration client. The caller must be authorized by Identity and the target canonical tenant ID must be derived from the caller’s current membership/support context.

When Académico calls on behalf of a signed-in tenant administrator, the adapter must propagate the end-user actor identity and correlation ID in an authenticated service-to-service envelope. A service credential alone is not sufficient to grant a human tenant-admin action. Identity authorizes the propagated actor, the target membership, and any explicit support context before mutating state.

### `POST /api/v1/tenants/{tenantId}/memberships`

Creates a membership for an existing user or provisions a new user with a selected username/email. The response contains membership state, assigned roles, and an activation action, never a password.

### `POST /api/v1/tenants/{tenantId}/memberships/{membershipId}/invite`

Creates or resends an email invitation. The response reports durable invitation state, not the invitation token.

### `POST /api/v1/tenants/{tenantId}/memberships/{membershipId}/activation-challenge`

Creates a no-email activation challenge for an authorized administrator. The plaintext code is returned only once in a protected response and is never recoverable later.

```json
{
  "membershipId": "mem_01J...",
  "username": "matias.gonzalez",
  "activationCode": "shown-once-to-authorized-admin",
  "expiresAt": "2026-08-09T12:00:00Z"
}
```

The endpoint must require a recent-authentication or step-up policy for revealing the code, and the response must not be logged.

The response must include `Cache-Control: no-store`; gateway, tracing, analytics, and application log pipelines must redact the response field.

### `PATCH /api/v1/tenants/{tenantId}/memberships/{membershipId}`

Changes membership status, username assignment, or role assignments according to the caller’s authority. Role changes and suspension revoke affected sessions.

### `POST /api/v1/tenants/{tenantId}/memberships/{membershipId}/revoke`

Revokes access without deleting the user or academic records.

## Integration endpoints

### `GET /.well-known/jwks.json`

Returns active public signing keys. Consumers cache keys with a bounded TTL and support key rotation overlap.

### `GET /api/v1/identity/health`

Operational health only; must not disclose tenant/user data.

### `POST /internal/v1/identity-users/resolve`

Restricted service-to-service endpoint for deliberate academic linking. Request may contain an exact normalized identifier and the canonical tenant context. Response is minimal: `userId`, safe verification status, and matching reason. It must not support unbounded directory search or return credentials, tokens, or unnecessary profile data.

The Academic API owns the link mutation on its `Student`/`Teacher` record. Identity may record the service actor and return a link-verification audit event, but does not create or own the academic link.

### `GET /internal/v1/sessions/{sessionId}/status`

Restricted status check for high-risk consumers. Returns active/revoked state, current user, and current membership context. It is not a substitute for normal JWT validation.

## Events and outbox contract

Identity may publish versioned events after durable state changes:

- `identity.user.created.v1`
- `identity.membership.created.v1`
- `identity.membership.activated.v1`
- `identity.membership.suspended.v1`
- `identity.membership.revoked.v1`
- `identity.role.changed.v1`
- `identity.session.revoked.v1`
- `identity.invitation.created.v1`

Identity email delivery uses the same durable `OutboxEvent` foundation with the internal event types
`identity.email.invitation.v1` and `identity.email.password-recovery.v1`. Email rows carry a unique
delivery key, bounded attempt count, provider response ID, sanitized last error, and pending/published/
failed state. The message body is protected in the outbox payload and is delivered only by the Identity
Resend adapter; invitation and reset domain records retain only one-time secret hashes.

Events are integration signals, not authorization proof. Consumers validate the issuer, event ID, schema version, timestamp, and replay/idempotency key, and recheck current membership before sensitive action.

## Contract examples and status codes

| Condition | HTTP | Stable code |
| --- | ---: | --- |
| Successful login/activation | 200/201 | — |
| Invalid credentials, unknown user, disabled account | 401 | `AUTHENTICATION_FAILED` |
| Missing or expired access token | 401 | `TOKEN_INVALID` |
| Valid identity but insufficient role/context | 403 | `FORBIDDEN` |
| Resource/membership not visible in current context | 404 | `NOT_FOUND` |
| Membership selection needed | 409 | `MEMBERSHIP_SELECTION_REQUIRED` |
| Expired/consumed invitation or activation challenge | 410 | `ACTIVATION_EXPIRED` |
| Brute-force or abuse throttle | 429 | `RATE_LIMITED` |
| Duplicate idempotency key with conflicting payload | 409 | `IDEMPOTENCY_CONFLICT` |
