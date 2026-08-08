# ADR-0005: short-lived JWT with rotated opaque refresh tokens

Status: Accepted
Date: 2026-08-08
Accepted: 2026-08-08
Decision authority: Identity architecture owner approval dated 2026-08-08

## Context

Académico needs a verifiable request token, while Identity must retain revocation and refresh-token control.

## Decision

Issue asymmetric signed access JWTs with a maximum 10-minute expiry and audience-specific claims, containing only the approved tenant context and minimum non-sensitive claims. Issue opaque refresh tokens stored only as hashes at rest, rotate them on every use, and revoke the entire family and session on reuse. Publish public keys through JWKS and support key rotation. Target a 30-day idle refresh/session lifetime and a 90-day absolute session lifetime. Use an `HttpOnly` + `Secure` refresh cookie for browser clients where topology permits and online session checks for high-risk actions.

## Consequences

- Normal API requests avoid an Identity round trip.
- Revocation of a normal access token is bounded by its short lifetime.
- Refresh rotation needs atomic transactions and concurrency tests.

## Acceptance evidence

- JWT validation and key-rotation tests.
- Concurrent refresh/reuse tests.
- Session revocation and stale-role tests.
