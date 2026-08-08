# ADR-0008: preserve existing EduPay administrative authentication

Status: Accepted
Date: 2026-08-08
Accepted: 2026-08-08
Decision authority: Identity architecture owner approval dated 2026-08-08

## Context

EduPay Identity is being introduced for new applications, beginning with Académico. The existing EduPay administrative login is an established system and must remain untouched initially.

## Decision

Treat the existing admin login and EduPay Identity as separate trust domains. Identity does not import its password hashes, validate its cookies, change its routes, or silently federate accounts. Académico’s Identity integration applies only to the new identity path unless a future migration/federation ADR is accepted.

## Consequences

- There may temporarily be two authentication systems in the ecosystem.
- Support and user-facing account terminology must make the boundary clear.
- Future migration requires explicit mapping, security review, and rollback planning.

## Acceptance evidence

- Existing admin login regression suite remains unchanged.
- Identity rejects existing-admin credentials/cookies unless a separately approved bridge exists.
- Architecture documentation clearly identifies the two trust domains.
