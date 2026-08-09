# ADR-0010: restricted EduPay Académico service authentication and verification

Status: Accepted
Date: 2026-08-09
Accepted: 2026-08-09
Decision authority: Identity owner-approved MVP service-auth boundary supplied for implementation

## Context

EduPay Académico must check current Identity session/membership state for high-risk
academic actions and verify an exact Student/Teacher to IdentityUser link. These reads
cannot be authorized by a browser access JWT alone: the caller is Académico's backend,
and link verification must also reauthorize the human tenant administrator from current
Identity-owned state.

The MVP does not require a general OAuth authorization server or a directory/search API.
It does require a replaceable workload-authentication boundary that can be operated safely
before stronger platform workload identity or mutual TLS is justified.

## Decision

Identity exposes only these service routes outside the browser `/api/v1` surface:

- `GET /internal/v1/sessions/{sessionId}/status`;
- `POST /internal/v1/identity-users/resolve`.

Académico authenticates with `Authorization: Bearer` using a server-only, randomly generated
service credential containing at least 32 random bytes. Identity compares fixed-length
credential digests in constant time. A normal Identity access JWT, browser cookie, origin,
or caller-selected authentication header cannot substitute for this credential.

`IDENTITY_ACADEMICO_SERVICE_TOKEN` is the current credential. Rotation may temporarily set
`IDENTITY_ACADEMICO_SERVICE_TOKEN_PREVIOUS` together with
`IDENTITY_ACADEMICO_SERVICE_TOKEN_PREVIOUS_EXPIRES_AT`. Identity accepts the previous value
only until that explicit time, and startup validation limits overlap to 24 hours. Tokens are
kept in managed server-side secret custody, never committed, sent to browsers, or logged.

Service authentication authorizes Académico as a workload only. The exact-link operation
also revalidates the supplied human actor's active user, unexpired/unrevoked session, selected
membership, tenant, tenant status, membership status, and current `TENANT_ADMIN` membership
role from Identity's database. Platform `SYSTEM_ADMIN` does not imply tenant administration.

The session-status operation accepts only the opaque session ID and derives user, membership,
tenant, expiry, revocation, and status from Identity state. The exact-link operation accepts
one exact target IdentityUser ID and one expected role (`STUDENT` or `TEACHER`). It supports no
listing, fuzzy search, identifier discovery, or mutation. A target membership may be `ACTIVE`
or `PENDING_ACTIVATION`; pending verification permits Académico to save its link but grants no
login or application access.

Internal traffic uses HTTPS and/or a private trusted network in production, correlation IDs,
bounded request bodies and queries, dedicated internal throttling, safe errors, and
non-sensitive security audit evidence. Requests carrying a browser `Origin` are denied, and
the internal controllers are omitted from the public OpenAPI document.

## Rotation procedure

1. Generate a new 32-byte-or-longer random token in approved secret custody.
2. Move the deployed current token into the previous-token secret, set an expiry no more than
   24 hours ahead, and deploy Identity with the new current token.
3. Update Académico to the new current token and verify internal health/contract calls.
4. Remove the previous token and expiry as soon as all instances use the new token, always
   before the configured expiry.
5. Treat unexpected credential use or a suspected disclosure as an incident and rotate
   immediately; never place token values in tickets, logs, or audit records.

## Consequences

- Académico can perform bounded fresh-state verification without direct Identity database access.
- The workload credential alone cannot mutate Identity state or authorize a human tenant action.
- A shared-secret rotation requires coordinated secret deployment during the bounded overlap.
- The authentication mechanism can later be replaced by platform workload identity or mTLS
  without changing the minimal verification semantics if operational requirements demand it.

## Acceptance evidence

- PostgreSQL-backed current/revoked/expired membership and cross-tenant negative tests.
- Current, previous-overlap, missing, wrong, browser-origin, and ordinary-JWT service-auth tests.
- Exact Student/Teacher, pending activation, actor reauthorization, and non-enumeration tests.
- Review confirms responses, errors, logs, audits, and documentation contain no service token.
