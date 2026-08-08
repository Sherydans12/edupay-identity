# ADR-0006: optional academic links owned by EduPay Académico

Status: Proposed; ownership split is mandated
Date: 2026-08-08

## Context

Student and teacher records have academic lifecycles and may exist without accounts. Matching a person to an Identity user is sensitive and must not silently change academic history.

## Proposal

Académico owns the optional `identityUserId` link on Student/Teacher. It initiates a deliberate, authorized, audited link through a restricted Identity lookup contract. Identity returns minimum necessary identity data and never creates or owns the academic record/link.

No automatic name-only matching is permitted. Email matching requires the approved verified-email/conflict policy.

## Consequences

- Academic records remain independent of authentication lifecycle.
- Link conflict and unlink rules must be explicit.
- Both services need correlation IDs and compatible audit evidence.

## Acceptance evidence

- Link/unlink authorization and conflict tests.
- Cross-tenant lookup tests.
- Proof that disabling/deleting identity access does not delete academic history.

