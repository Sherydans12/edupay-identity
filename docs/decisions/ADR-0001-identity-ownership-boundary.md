# ADR-0001: independent Identity ownership boundary

Status: Accepted
Date: 2026-08-08
Accepted: 2026-08-08
Decision authority: Identity architecture owner approval dated 2026-08-08

## Context

Multiple EduPay applications need centralized authentication, while EduPay Académico owns academic records and must remain independently deployable. Sharing credentials or academic tables would couple migrations and authorization boundaries.

## Decision

EduPay Identity owns users, login identifiers, credentials, sessions, refresh tokens, memberships, roles, invitations, activation, password recovery, and authentication audit. EduPay Académico owns Student, Teacher, Course, Subject, Assignment, Payment, Debt, Grade, and Attendance records.

Académico may store an optional stable `identityUserId` and must not store credentials or refresh tokens.

Identity owns only the minimum `TenantRealm` needed for authentication and membership. Its stable tenant identifier is the canonical ecosystem tenant identifier and is the same logical identifier used by the Académico tenant record. The services keep independent databases, use no cross-service foreign keys or direct table access, and exchange the identifier through authenticated contracts only.

## Consequences

- Centralized authentication and consistent security controls.
- Explicit service/API contracts and eventual consistency for non-critical events.
- Academic records can exist before identity activation and survive unlinking.

## Acceptance evidence

- Separate persistence ownership and no cross-database table reads.
- Contract tests for token/session validation.
- Negative tests proving academic operations cannot access Identity secrets.
