# Identity implementation bootstrap

Status: implementation note; does not replace accepted architecture or ADRs

## Repository and tooling choice

The service uses a backend-first, single-package repository because the accepted scope currently contains one independently deployable NestJS service and no justified web application. pnpm 10.19 is the implementation-level package-manager choice; no accepted package-manager decision existed.

The runtime uses NestJS 11, strict TypeScript, Prisma 7 with the PostgreSQL driver adapter, PostgreSQL 15, and Zod 4 environment validation. Prisma Client is generated into an ignored source directory during validation and build.

## Module seams

- `config`: fail-fast environment parsing without echoing configuration values.
- `common`: request-ID propagation and the stable safe error envelope.
- `health`: operational liveness only; no user or tenant data.
- `persistence`: the Identity-owned Prisma client and schema.
- `security`: Argon2id, opaque one-time token issuance/hashing, safe audit persistence, trusted tenant-context checks, and a fail-closed rate-limit seam.
- `jwt`: external private-key loading, access-token claim construction, and public-only JWKS publication.

Authentication feature controllers are intentionally absent. Adding login, activation, invitation, refresh, recovery, or membership management requires the corresponding domain rules, transactions, throttling adapter, and accepted security tests; the bootstrap does not expose a partially protected flow.

## Configuration and key custody

All environment values are explicit. The accepted access-token ceiling is validated at 600 seconds. Exact Argon2 costs, JWKS cache timing, and other unresolved operational tunables have no application defaults and must be selected by the deployment owner.

`JWT_PRIVATE_KEY_PATH` points to externally supplied PKCS#8 private key material. `JWT_PUBLIC_JWKS_PATH` points to a separately supplied public JWKS. The service refuses a JWKS containing private RSA, EC, symmetric, or multi-prime members and requires the active key ID/algorithm to be present.

`pnpm keys:generate:dev` creates disposable RSA development keys only under ignored runtime storage. It fails instead of overwriting existing keys. Production key generation, custody, rotation overlap, retirement, and incident handling remain external operational responsibilities as required by the accepted architecture.

## Persistence rules established

The initial migration establishes Identity users, separate login identifiers, password credentials, tenant realms, memberships, membership and platform role assignments, sessions, rotated refresh tokens, invitations, activation challenges, password-reset tokens, authentication audit events, and a durable outbox.

Database constraints provide these bootstrap guarantees:

- a username belongs to a tenant realm and is unique after normalization within that realm;
- email identifiers are global, may be absent, and only verified normalized values are globally unique;
- one user has at most one membership in a tenant;
- a session can select an active membership record belonging to the same user only;
- `SYSTEM_ADMIN` is platform-scoped, while approved membership roles are tenant-scoped;
- secrets have hash fields only; there are no plaintext token, password, or activation-code columns.

The schema contains no academic entity, cross-service foreign key, or direct dependency on EduPay Académico or existing EduPay.

## Deferred feature and operational work

Before feature endpoints are enabled, implementation still needs the accepted flow-level transactions and policies, a durable distributed rate-limit/lockout adapter with approved parameters, identifier-normalization decisions/tests, refresh reuse concurrency handling, session revocation behavior, support-elevation design, notification delivery/worker wiring, production key custody and rotation operations, and full provider/contract/security scenarios.
