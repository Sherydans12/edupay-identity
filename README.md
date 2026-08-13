# EduPay Identity

EduPay Identity is the independent authentication and tenant-membership service for the EduPay ecosystem. This repository deliberately contains no academic records or academic resource-authorization policies.

The current phase provides the backend-first NestJS authentication core plus safe account lifecycle operations: password login, short-lived access tokens, rotated opaque refresh tokens, browser-safe HttpOnly refresh cookies with trusted-origin/CORS protections, session logout/revocation, authenticated user and membership reads, membership-derived tenant-context switching, tenant-admin provisioning and membership management, email invitations, no-email activation challenges, password recovery, durable Identity email delivery intents, and security audit/event evidence. It does not include academic records or an administration frontend.

## Requirements

- Node.js 22 or later
- pnpm 10.19
- PostgreSQL 15 for migrations and integration tests

## Local setup

1. Run `pnpm install`.
2. Copy `.env.example` to an untracked `.env` and supply every value through local secret/configuration management.
3. For disposable development-only signing material, run `pnpm keys:generate:dev`. The command writes into the ignored `runtime/keys` directory and never prints private key material.
4. Run `pnpm prisma:migrate:deploy` against an Identity-owned PostgreSQL 15 database.
5. Run `pnpm dev`.

The email delivery worker is independently runnable after `pnpm build` with `pnpm email:deliver`. It claims pending Identity email intents, delivers through Resend with an idempotency key, and records bounded retry or terminal-failure state. Membership changes are committed independently of provider delivery.

The first production `TenantRealm` and `TENANT_ADMIN` are created only through the operator-local `pnpm bootstrap:tenant-admin` command. It requires an explicit canonical tenant UUID, Identity tenant handle, institutional username, and code or email activation. It never accepts or creates a permanent password, and compatible reruns never reveal a prior activation secret. Follow the coordinated Identity/Académico procedure in [docs/implementation/production-tenant-bootstrap.md](docs/implementation/production-tenant-bootstrap.md).

For a controlled correction of an already-active account’s email, use only the private operator-local `pnpm operator:correct-email` command documented in [docs/implementation/operator-email-correction.md](docs/implementation/operator-email-correction.md). It is audited, revokes affected sessions and reset artifacts, and never sets a password.

Production private signing keys must be supplied through external managed key/secret custody. They must never be committed. The public JWKS is loaded separately, checked for private JWK members, and exposed at `/.well-known/jwks.json`.

## Validation

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

Set `TEST_DATABASE_URL` to a disposable migrated PostgreSQL 15 database to activate the persistence integration suite. GitHub Actions provisions PostgreSQL 15 and runs that suite on every validation job.

The API health endpoint is `GET /api/v1/identity/health`. OpenAPI is generated at `/api/docs`. Future user or administrator web interfaces must consume the versioned REST/OpenAPI boundary; no shared database or cookie trust with other EduPay applications is permitted. Browser clients keep access tokens in memory and use Identity’s HttpOnly refresh cookie with `credentials: 'include'`; they must not use localStorage for tokens.

The authentication endpoints are under `/api/v1/auth`. The local Académico JWKS consumer path is documented in [docs/implementation/academico-local-integration.md](docs/implementation/academico-local-integration.md).

Read the authoritative architecture and decisions from [docs/README.md](docs/README.md) before implementing feature flows.
