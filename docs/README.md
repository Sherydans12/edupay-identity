# EduPay Identity documentation

Status: proposed Identity architecture for review

EduPay Identity is an independent centralized identity service for EduPay ecosystem applications. It is the source of truth for authentication and access-management implementation details. EduPay Académico consumes this service through explicit contracts and remains the owner of academic records.

## Reading order

1. [Identity architecture](architecture/identity-architecture.md)
2. [API contracts](architecture/api-contracts.md)
3. [Security threat model](security/threat-model.md)
4. [Testing strategy](architecture/testing-strategy.md)
5. [ADR proposals](decisions/README.md)

## Governing constraints

- Identity owns users, login identifiers, credentials, sessions, refresh tokens, tenant memberships, roles, invitations, activation, password recovery, and authentication audit events.
- Identity does not own Student, Teacher, Course, Subject, Assignment, Payment, Debt, Grade, or Attendance records.
- A student or teacher record may exist without an Identity account and may optionally reference an Identity user.
- Email is optional. Institutional username is a first-class login identifier.
- A client-provided `tenantId` is never trusted as authorization context.
- MVP roles are `SYSTEM_ADMIN`, `TENANT_ADMIN`, `TEACHER`, and `STUDENT`; `GUARDIAN` remains a future-compatible role with no MVP UI.
- The existing EduPay administrative authentication remains untouched initially. No migration, federation, or login redesign is part of this repository’s MVP.

## Relationship to EduPay Académico

The architecture is aligned with the read-only baseline in `C:\Users\nicol\Documents\EduPayAcademico\docs`, especially its system context, identity model, multitenancy rules, security architecture, integration boundary, unresolved decisions, and ADRs 0001–0004 and 0008. No files in that repository are modified by this project.

