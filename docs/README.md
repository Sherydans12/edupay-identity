# EduPay Identity documentation

Status: implemented Identity service; the current documented release is dated 2026-09-24.
Latest reported Git `origin/main` on 2026-09-24: `57b8827008c4a7b92c60a435b3fb1bc4f7554492`. This Git ref is not the deployed image identity. The last runtime evidence is the linked release closeout; this edit does not recheck Coolify.

EduPay Identity is an independent centralized identity service for EduPay ecosystem applications. It is the source of truth for authentication and access-management implementation details. EduPay Académico consumes this service through explicit contracts and remains the owner of academic records.

## Empieza aquí

- [Mapa transversal: dominios, integraciones, estado y pendientes](https://github.com/Sherydans12/edupay-academico/blob/main/docs/architecture/edupay-ecosystem-architecture.md)
- [Release DIE y evidencia de producción del 24/09](operations/die-release-authorization-runbook.md)
- [Arquitectura, contratos y ADRs](architecture/identity-architecture.md), [API](architecture/api-contracts.md), [decisiones](decisions/README.md)
- [Bootstrap coordinado de tenant Identity/Académico](implementation/production-tenant-bootstrap.md)

El piloto DIE está desplegado como módulo de Académico pero sigue sin
configuración ni validación con usuarios reales. El release no creó cuentas,
memberships, perfiles ni expedientes de piloto. La verificación productiva más
nueva publicada está en [el cierre de release](operations/die-release-authorization-runbook.md)
y en el [cierre transversal](https://github.com/Sherydans12/edupay-academico/blob/main/docs/operations/die-release-closeout-2026-09-24.md).

## Reading order

1. [Identity architecture](architecture/identity-architecture.md)
2. [API contracts](architecture/api-contracts.md)
3. [Security threat model](security/threat-model.md)
4. [Testing strategy](architecture/testing-strategy.md)
5. [Accepted ADRs](decisions/README.md)

Implementation notes that do not replace the accepted baseline:

- [Application bootstrap](implementation/bootstrap.md)
- [Production tenant-admin bootstrap](implementation/production-tenant-bootstrap.md)
- [Operator email correction](implementation/operator-email-correction.md)

## Governing constraints

- Identity owns users, login identifiers, credentials, sessions, refresh tokens, tenant memberships, roles, invitations, activation, password recovery, and authentication audit events.
- Identity does not own Student, Teacher, Course, Subject, Assignment, Payment, Debt, Grade, or Attendance records.
- A student or teacher record may exist without an Identity account and may optionally reference an Identity user.
- Email is optional. Institutional username is a first-class login identifier.
- A client-provided `tenantId` is never trusted as authorization context.
- The canonical ecosystem tenant identifier is the same stable logical identifier in Identity's `TenantRealm` and Académico's tenant record. Databases remain independent, have no cross-service foreign keys, and exchange the identifier only through authenticated integration contracts.
- Tenant roles include `TENANT_ADMIN`, `TEACHER`, `STAFF`, `STUDENT`, and `GUARDIAN`. `STAFF` authenticates as tenant personnel but grants no application capability by itself.
- Identity grants tenant membership roles only. Académico decides subject, roster, learning-content, assignment, and submission access through resource policies.
- `SYSTEM_ADMIN` does not automatically become a tenant member. Tenant support requires an explicit elevated support context, reason, and audit record. User impersonation is out of scope for MVP.
- Access JWTs are asymmetric-signed and expire within 10 minutes. Refresh tokens are opaque, rotated, hashed at rest, and family-revoking on reuse; browser refresh tokens use `HttpOnly` and `Secure` cookies where topology permits.
- The existing EduPay administrative authentication remains untouched initially. No migration, federation, or login redesign is part of this repository’s MVP.
- Restricted Académico verification uses a server-only service credential plus current Identity database reauthorization for human-sensitive link actions; it is not a directory or delegated mutation API.

## Relationship to EduPay Académico and BL-002

Académico consumes Identity through validated JWT/JWKS and bounded internal
service routes over the private Coolify network. Identity owns authentication
and membership; Académico owns academic permissions and DIE records. BL-002
keeps its existing authentication boundary and financial records; the current
financial projection remains disabled. The [shared ecosystem map](https://github.com/Sherydans12/edupay-academico/blob/main/docs/architecture/edupay-ecosystem-architecture.md)
is the entry point for cross-repository status. This repository remains
authoritative for Identity contracts, configuration and local decisions.
