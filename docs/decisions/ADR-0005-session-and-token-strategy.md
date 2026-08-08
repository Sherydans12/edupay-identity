# ADR-0005: short-lived JWT with rotated opaque refresh tokens

Status: Proposed
Date: 2026-08-08

## Context

Académico needs a verifiable request token, while Identity must retain revocation and refresh-token control.

## Proposal

Issue asymmetric signed access JWTs with a 10-minute expiry and audience-specific claims. Issue opaque refresh tokens stored only as hashes, rotate them on every use, and revoke the entire family on reuse. Publish public keys through JWKS. Use online session checks for high-risk actions.

## Consequences

- Normal API requests avoid an Identity round trip.
- Revocation of a normal access token is bounded by its short lifetime.
- Refresh rotation needs atomic transactions and concurrency tests.

## Acceptance evidence

- JWT validation and key-rotation tests.
- Concurrent refresh/reuse tests.
- Session revocation and stale-role tests.

