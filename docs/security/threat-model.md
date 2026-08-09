# EduPay Identity threat model

Status: approved security baseline
Date: 2026-08-08
Accepted: 2026-08-08

## Assets and trust boundaries

### Assets

- Password verifiers and credential state.
- Active sessions, refresh-token families, and signing keys.
- Identity user IDs, usernames, optional email addresses, and membership/role assignments.
- Invitation, recovery, and no-email activation secrets.
- Authentication and membership audit evidence.
- The trusted tenant/membership context consumed by EduPay Académico.
- The canonical ecosystem tenant identifier exchanged between independent services.

### Trust boundaries

1. Browser/client to Identity API.
2. Identity API to Identity database/cache/queue.
3. Identity notification worker to Resend.
4. Identity to EduPay Académico through JWT, JWKS, APIs, and events.
5. Identity management caller to membership administration.
6. Identity to the existing EduPay administrative login, which remains a separate trust domain.

## Threats and mitigations

| Threat | Consequence | Mitigations | Evidence |
| --- | --- | --- | --- |
| Password guessing/credential stuffing | Account takeover | Argon2id, rate limits by IP/identifier/tenant, progressive backoff, lockout, generic errors, monitoring | Abuse tests and alert rehearsal |
| Password/hash disclosure | Broad account compromise | Argon2id, secret redaction, restricted DB access, no plaintext secrets, rehash upgrades | Secret scan and database review |
| Refresh-token theft | Persistent session takeover | Opaque hashed tokens, rotation, family reuse detection, secure host-only `HttpOnly` cookies, browser-origin validation, session revocation, short access TTL | Concurrent rotation/reuse and browser-cookie tests |
| JWT theft | Temporary unauthorized access | TLS, frontend-memory-only browser storage, 10-minute expiry, audience/issuer validation, high-risk online checks | Token validation and browser-response tests |
| Signing-key compromise | Forged tokens | Asymmetric keys, JWKS, KID rotation, secret-manager custody, overlap/revocation runbook | Key rotation exercise |
| Tenant-ID tampering | Cross-tenant access | Membership-derived context, token-issued active membership, scoped repositories, explicit support context | Two-tenant negative suite |
| Canonical tenant-ID confusion or cross-service coupling | Wrong tenant mapping or loss of service independence | Same stable logical tenant identifier in each service, authenticated contract exchange, no cross-service foreign keys or direct database access | Contract and boundary review |
| Role claim abuse/staleness | Privilege escalation | Validate signature/audience/expiry, session revocation, bounded staleness, fresh checks for high-risk actions, resource policies in Académico | Role-change and stale-token tests |
| Invitation link theft/replay | Unauthorized account activation | Random one-time hash-only tokens, expiry, single use, tenant confirmation, revocation, audit | Expiry/replay tests |
| No-email activation-code observation | Student account takeover | One-time code, short expiry, attempt limits, protected one-time admin display, no logs, regeneration, no permanent admin password | Handoff and guessing tests |
| User/tenant enumeration | Privacy leakage and targeted abuse | Generic login/recovery/invite responses, bounded membership results, consistent timing/error behavior | Enumeration test matrix |
| Ambiguous username/email matching | Wrong-account login or privacy leak | Explicit identifier kinds, normalization, tenant realm scoping, ambiguity rejection, verified-email policy | Collision fixture tests |
| Unauthorized academic linking | Wrong person gains academic access | Académico owns link, explicit service contract, exact matching/verification, deliberate admin action, audit, no name-only matching | Link conflict/authorization tests |
| Over-privileged system-admin support | Broad data exposure | No implicit tenant context, explicit elevation/reason, step-up auth, scoped support session, audit, no silent impersonation | Support-path review |
| CSRF/XSS/open redirect | Token theft or unwanted mutations | SameSite cookies, exact trusted-origin checks independent of CORS, Fetch Metadata defense in depth, output encoding, allowlisted redirects, secure headers, input validation | Browser origin/CORS and cookie tests |
| Resend/provider outage | Activation cannot complete or state is lost | Durable invitation/outbox state, retries, idempotency, visible delivery status, manual resend | Provider-failure integration tests |
| Audit tampering or secret leakage | Weak incident response/privacy harm | Append-only behavior, restricted reads, safe metadata allowlist, correlation IDs, retention policy | Redaction and access tests |
| Replay of internal event/callback | Duplicate or cross-tenant mutation | Signed/authenticated callbacks, event IDs, timestamps, replay window, idempotent consumers, context recheck | Replay tests |
| Denial of service | Authentication unavailable | Request/body limits, bounded queries, rate limits, queue backpressure, circuit breakers, health endpoints | Load/limit tests |
| Clock/key configuration error | Invalid or overlong sessions | UTC storage, bounded clock skew, key overlap, operational alerts, time-boundary tests | Time-skew and rotation tests |
| Data retention/privacy failure | Regulatory or trust impact | Minimize profile data, retention/deletion policy, coarse device/IP metadata, no academic data in Identity | Privacy review |

## Required operational controls

- Secrets and signing keys are managed outside source control and rotated by an owned runbook.
- Authentication failures, refresh reuse, activation guessing, role changes, session revocations, and support elevations are observable without logging secrets.
- Browser JSON responses, errors, audit metadata, and application logs must not contain refresh-cookie values; `Set-Cookie` headers are treated as secret-bearing output and are not logged.
- Identity and Académico correlate events through request/correlation IDs and `sid`, but each service owns its audit stream.
- Restore testing proves that revocation, invitation, and audit state are backed up consistently enough for the agreed RTO/RPO.
- Security review occurs before exposing the no-email activation handoff to a pilot school.
