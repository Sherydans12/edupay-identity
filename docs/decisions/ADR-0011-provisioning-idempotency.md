# ADR-0011: transactional membership-provisioning idempotency

Status: Accepted for the no-producción hardening branch
Date: 2026-08-31
Accepted: 2026-08-31
Decision authority: Identity owner-approved security hardening

## Context

Membership provisioning creates an Identity user, tenant membership, identifiers,
roles, audit evidence, and durable outbox events. A retry after a network failure
must not create a second account or return a different membership. A lookup by
username is insufficient: it is not an operation receipt, cannot distinguish a
retry from a new request, and does not provide a concurrency boundary.

## Decision

`POST /api/v1/tenants/{tenantId}/memberships` accepts an optional opaque
`Idempotency-Key`. The key is unique by operation, authenticated actor, and
canonical tenant context. The request body is normalized by Identity and hashed
with deterministic recursive JSON canonicalization. The request body itself is
not persisted.

The provisioning records and `ProvisioningIdempotencyReceipt` are created in
the same PostgreSQL transaction. The receipt contains only the operation scope,
payload hash, HTTP status, and the safe response body needed for exact replay;
it contains no password, token, secret, or raw request payload. The response is
canonicalized before it is returned and persisted so a replay has the same HTTP
status and JSON body.

The composite unique constraint is the concurrency authority. If PostgreSQL
reports a unique violation, the transaction is rolled back. A losing request
then reads the committed receipt: matching hashes replay; different hashes
return `409 IDEMPOTENCY_CONFLICT`. Unique violations without a matching receipt
are mapped to the existing safe `409 CONFLICT` response and never leak as `500`.

The header remains optional for compatibility with existing callers. Requests
without it retain normal membership/identifier uniqueness semantics and do not
create a receipt.

## Consequences

- Network retries are safe and return the same generated user and membership IDs.
- PostgreSQL, rather than process-local memory, coordinates concurrent service
  instances and survives process restarts.
- Receipts require retention/cleanup operations to be defined before unbounded
  long-term use; cleanup must not run while a caller may still retry a key.
- The canonical hash contract is part of the API behavior and must be tested
  whenever provisioning fields change.

## Acceptance evidence

- Sequential replay returns byte-identical `201` JSON and creates one receipt.
- A changed payload returns `409 IDEMPOTENCY_CONFLICT` without new records.
- Two `Promise.all` requests against real PostgreSQL return the same response and
  commit one provisioning operation and one receipt.
- A failure after intermediate writes leaves users, membership, identifiers,
  roles, outbox, audit, and receipt unchanged.
