# ADR-0001: independent Identity ownership boundary

Status: Proposed; ownership split is mandated
Date: 2026-08-08

## Context

Multiple EduPay applications need centralized authentication, while EduPay Académico owns academic records and must remain independently deployable. Sharing credentials or academic tables would couple migrations and authorization boundaries.

## Proposal

EduPay Identity owns users, login identifiers, credentials, sessions, refresh tokens, memberships, roles, invitations, activation, password recovery, and authentication audit. EduPay Académico owns Student, Teacher, Course, Subject, Assignment, Payment, Debt, Grade, and Attendance records.

Académico may store an optional stable `identityUserId` and must not store credentials or refresh tokens.

## Consequences

- Centralized authentication and consistent security controls.
- Explicit service/API contracts and eventual consistency for non-critical events.
- Academic records can exist before identity activation and survive unlinking.

## Acceptance evidence

- Separate persistence ownership and no cross-database table reads.
- Contract tests for token/session validation.
- Negative tests proving academic operations cannot access Identity secrets.

