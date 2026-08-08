# EduPay Identity documentation

Status: approved Identity architecture baseline; implementation may begin only within these boundaries
Accepted: 2026-08-08

EduPay Identity is an independent centralized identity service for EduPay ecosystem applications. It is the source of truth for authentication and access-management implementation details. EduPay Académico consumes this service through explicit contracts and remains the owner of academic records.

## Reading order

1. [Identity architecture](architecture/identity-architecture.md)
2. [API contracts](architecture/api-contracts.md)
3. [Security threat model](security/threat-model.md)
4. [Testing strategy](architecture/testing-strategy.md)
5. [Accepted ADRs](decisions/README.md)

Implementation notes that do not replace the accepted baseline:

- [Application bootstrap](implementation/bootstrap.md)

## Governing constraints

- Identity owns users, login identifiers, credentials, sessions, refresh tokens, tenant memberships, roles, invitations, activation, password recovery, and authentication audit events.
- Identity does not own Student, Teacher, Course, Subject, Assignment, Payment, Debt, Grade, or Attendance records.
- A student or teacher record may exist without an Identity account and may optionally reference an Identity user.
- Email is optional. Institutional username is a first-class login identifier.
- A client-provided `tenantId` is never trusted as authorization context.
- The canonical ecosystem tenant identifier is the same stable logical identifier in Identity's `TenantRealm` and Académico's tenant record. Databases remain independent, have no cross-service foreign keys, and exchange the identifier only through authenticated integration contracts.
- MVP roles are `SYSTEM_ADMIN`, `TENANT_ADMIN`, `TEACHER`, and `STUDENT`; `GUARDIAN` remains a future-compatible role with no MVP UI.
- Identity grants tenant membership roles only. Académico decides subject, roster, learning-content, assignment, and submission access through resource policies.
- `SYSTEM_ADMIN` does not automatically become a tenant member. Tenant support requires an explicit elevated support context, reason, and audit record. User impersonation is out of scope for MVP.
- Access JWTs are asymmetric-signed and expire within 10 minutes. Refresh tokens are opaque, rotated, hashed at rest, and family-revoking on reuse; browser refresh tokens use `HttpOnly` and `Secure` cookies where topology permits.
- The existing EduPay administrative authentication remains untouched initially. No migration, federation, or login redesign is part of this repository’s MVP.

## Relationship to EduPay Académico

The architecture is aligned with the read-only baseline in `C:\Users\nicol\Documents\EduPayAcademico\docs`, especially its system context, identity model, multitenancy rules, security architecture, integration boundary, unresolved decisions, and ADRs 0001–0004 and 0008. No files in that repository are modified by this project.
