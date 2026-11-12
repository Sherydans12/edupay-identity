# Provisioning idempotency history reconciliation

## Why this migration is restored

The production Identity ledger contains `20260831000000_provisioning_idempotency_receipts`
with Prisma checksum
`c615b7fd9db0ea642ad08fa5981f498dd9a73e97b9db7c0d2d0d2d7cd53eb68b`.
The exact SQL blob is recovered from commit
`31526b53d09df67b504262da2be9df233ff33e7a`; its Git blob is
`a47198a58a845e485b45425636581fc1b3fa6b4e`. Byte comparison and SHA-256
calculation confirm the recovered file is identical. Do not edit that SQL.

The recovered commit is present in the repository object database and on the
`codex/identity-hardening-no-produccion` lineage, but it is not an ancestor of
the fetched `origin/main` or STAFF candidate. The exact reason it was omitted
from the integration history cannot be established from Git evidence. The
observable cause is that the hardening branch did not enter either lineage even
though its migration had already been applied in production.

The original change includes one persistent receipt table and the matching
Prisma model, canonical JSON hashing, the optional `Idempotency-Key` request
header, transactional receipt writes/replays, conflict handling, CORS allowance,
API contract text, and PostgreSQL integration coverage. Current STAFF and
recovery/outbox behavior had no equivalent durable provisioning idempotency
mechanism. The feature has been adapted onto the current STAFF candidate; its
user, membership, role, audit, and outbox writes remain in the existing
provisioning transaction. Receipt replays still require a current tenant admin
context, rate-limit capacity, and an active tenant. Activation/reset secrets
and raw request bodies are not stored in receipts.

## ADR history

ADR-0011 was accepted on 2026-08-31 for transactional provisioning idempotency.
STAFF/exact personnel resolution was accepted on 2026-09-23 and had reused the
same number. Both decisions remain intact: idempotency is ADR-0011 and STAFF is
ADR-0012. References are listed in `docs/decisions/README.md`.

## Reproduce the PostgreSQL upgrade check

This procedure uses an isolated local PostgreSQL instance only. Never point it
at production or a shared environment. It models the three production
migrations (foundation, account lifecycle, and idempotency receipts), inserts
synthetic identity/tenant/receipt rows, then runs the candidate migration
runner. It asserts that STAFF is the only migration added and that the three
historical checksums and synthetic rows remain unchanged.

1. Start a local PostgreSQL 15 instance on an unused loopback port, with a
   disposable database and credentials. For example, Docker Desktop can run a
   standalone PostgreSQL container; this test does not start the Identity
   service or use Compose.
2. Create an empty database named `identity_idempotency_upgrade_test`.
3. In this repository, install dependencies with `corepack pnpm@10.19.0
   install --frozen-lockfile`.
4. Set `DATABASE_URL` to that database on `localhost`/`127.0.0.1`, then run
   `corepack pnpm@10.19.0 verify:provisioning-upgrade`.

The script refuses non-loopback hosts, any other database name, or a database
that already contains the Identity ledger or user table. It writes only
synthetic values. It applies the exact first three migration SQL files and
records their file checksums as the production baseline, then calls the checked
out Prisma migration runner. Expected output starts with `PASS upgrade from
three historical migrations` and lists only
`20260924000000_add_staff_role` as applied. The database is disposable and may
be dropped after review.

For a fresh-install check, set `DATABASE_URL` to a second empty local database
and run `corepack pnpm@10.19.0 prisma:migrate:deploy`. Expected order is the two
base migrations, receipts, then STAFF. Confirm `prisma migrate status` only as
an additional ledger check; it does not replace the behavioral tests below.

## Regression and CI commands

With a local disposable PostgreSQL database migrated through all four current
migrations and `DATABASE_URL` plus `TEST_DATABASE_URL` set to it, run:

```powershell
corepack pnpm@10.19.0 lint
corepack pnpm@10.19.0 typecheck
corepack pnpm@10.19.0 prisma:validate
corepack pnpm@10.19.0 test
corepack pnpm@10.19.0 build
```

The PostgreSQL suite covers normalized sequential replay, different-payload
conflict, same-key concurrency, distinct-key uniqueness races, complete
transaction rollback, and suspension of a tenant between provisioning and
replay. The full suite also covers STAFF roles and the exact tenant-membership
resolution contract. The Académico real-service STAFF smoke remains the
cross-service check for Identity provisioning/login and Identity→Académico S2S
membership resolution.

## Release artifact handling

The migration publish workflow now builds the dispatched `github.sha`, pins its
build actions, verifies the migration command and revision label, and records
BuildKit provenance/SBOM. Runtime and migration images built locally are useful
for local verification only; their local image IDs are not GHCR digests. Do not
publish or deploy from this procedure. For a release, publish from the final
PR SHA, inspect the remote immutable reference, and record its actual registry
digest in the operational package.
