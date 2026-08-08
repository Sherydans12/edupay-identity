# ADR-0007: versioned Identity API, JWKS, and durable events

Status: Accepted
Date: 2026-08-08
Accepted: 2026-08-08
Decision authority: Identity architecture owner approval dated 2026-08-08

## Context

EduPay Académico and future applications need stable integration while Identity state changes such as invitations and membership activation may require asynchronous work.

## Decision

Use REST/JSON under `/api/v1`, OpenAPI at the service boundary, opaque IDs, stable error envelopes, JWKS for token validation, and versioned events from a durable outbox. Resend is the initial Identity notification adapter. The canonical tenant identifier is exchanged only through authenticated contracts. Events are notifications, not authorization proof; consumers recheck current state for sensitive actions.

## Consequences

- Contract and schema compatibility become release concerns.
- Provider outages do not discard durable invitation state.
- An event broker/worker and idempotent consumers are required when asynchronous delivery is enabled.

## Acceptance evidence

- OpenAPI/JWKS contract tests.
- Event replay/idempotency tests.
- Resend failure and retry tests.
