# EduPay Identity

EduPay Identity is the independent authentication and tenant-membership service for the EduPay ecosystem. This repository deliberately contains no academic records or academic resource-authorization policies.

The current phase is a backend-first NestJS bootstrap. It establishes the accepted service, persistence, cryptography, JWT/JWKS, audit, testing, and CI boundaries without exposing incomplete authentication flows or scaffolding an administration frontend.

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

Production private signing keys must be supplied through external managed key/secret custody. They must never be committed. The public JWKS is loaded separately, checked for private JWK members, and exposed at `/.well-known/jwks.json`.

## Validation

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

Set `TEST_DATABASE_URL` to a disposable migrated PostgreSQL 15 database to activate the persistence integration suite. GitHub Actions provisions PostgreSQL 15 and runs that suite on every validation job.

The API health endpoint is `GET /api/v1/identity/health`. OpenAPI is generated at `/api/docs`. Future user or administrator web interfaces must consume the versioned REST/OpenAPI boundary; no shared database or cookie trust with other EduPay applications is permitted.

Read the authoritative architecture and decisions from [docs/README.md](docs/README.md) before implementing feature flows.
