# ADR-0006: optional academic links owned by EduPay Académico

Status: Accepted
Date: 2026-08-08
Accepted: 2026-08-08
Decision authority: Identity architecture owner approval dated 2026-08-08

## Context

Student and teacher records have academic lifecycles and may exist without accounts. Matching a person to an Identity user is sensitive and must not silently change academic history.

## Decision

Académico owns the optional `identityUserId` link on Student/Teacher. It initiates a deliberate, authorized, audited link through a restricted Identity lookup contract. Identity returns minimum necessary identity data and never creates or owns the academic record/link.

No automatic name-only matching is permitted. Email matching requires the approved verified-email/conflict policy. Identity returns only the minimum identity data required for verification. Identity grants tenant membership roles only; Académico remains responsible for all academic resource policies.

## Consequences

- Academic records remain independent of authentication lifecycle.
- Link conflict and unlink rules must be explicit.
- Both services need correlation IDs and compatible audit evidence.

## Acceptance evidence

- Link/unlink authorization and conflict tests.
- Cross-tenant lookup tests.
- Proof that disabling/deleting identity access does not delete academic history.
