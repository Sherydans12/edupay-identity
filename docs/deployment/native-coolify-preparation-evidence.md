# Native Coolify preparation evidence

Status: `IDENTITY_EMAIL_VERIFICATION_GATE_REVIEW=PASS`

Final state: `HOLD_PENDING_FINAL_CUTOVER_AUTHORIZATION`

## Reviewed Identity runtime

- Identity PR #3 was merged. `NEW_IDENTITY_REVIEWED_SHA=4a684fac5734d24a553d174cb7c3ae3c615c942a` and `origin/main` was verified at that exact merge commit.
- Post-merge GitHub Actions run `31869713524` passed lint, typecheck, Prisma validation/migration deployment, tests, build, runtime and migration Docker builds, runtime artifact smoke, and both operator CLI help smokes.
- The private native Identity runtime was rebuilt from that SHA. Runtime image: `sha256:ef71605e278191c95a53e68ae11992359084c8030b8d0cff1e84643a9ae612fb`.
- Runtime verification passed: CMD `node dist/main.js`; HEALTHCHECK present and healthy; UID `10001`; `/keys` present; and all required artifacts present, including both email operator CLIs.
- Two forced private redeploys passed with the reviewed SHA, reviewed runtime image, required artifacts, healthy private health/JWKS responses, and unchanged key fingerprints.
- Key custody passed: host and container key fingerprints matched the pre-rebuild baseline; UID `10001` retained read access and write, append, truncate, delete, rename, and chmod attempts were denied.

## PostgreSQL 15 compatibility and backups

- Historical recovery point `20260814T220642Z` was not modified. Its custom archive format is `1.15`; PostgreSQL 15 `pg_restore` cannot read that archive directly. The previous restore client was PostgreSQL `17.11`, while the target server is PostgreSQL `15.19`.
- Both root-only backup launchers had selected a PostgreSQL 16 helper. The helper image was narrowed to PostgreSQL 15, with launcher tags updated from `postgres16-awscli` to `postgres15-awscli`; both launchers remain `root:root` mode `0700`. No backup business logic changed.
- The rebuilt helper reports `pg_dump 15.19` and `pg_restore 15.19`.
- A clean, isolated PostgreSQL 15 restore of the immutable historical archive succeeded. PostgreSQL 17 rendered owner-neutral SQL; exactly one unsupported `SET transaction_timeout = 0;` statement was removed; the resulting SQL was applied with `ON_ERROR_STOP=1`. `DISPOSABLE_IDENTITY_RESTORE_EXIT=0` and no ignored errors occurred.
- The historical fixture integrity gate passed: one tenant-scoped USERNAME, one active membership, TENANT_ADMIN present, zero baseline EMAIL identifiers, one active session, two Prisma migrations, and expected Identity table counts.
- New non-authoritative backup proof `PG15_BACKUP_TOOLING_PROOF=20260815T071015Z` passed: Identity and Academic dumps, private-files archive, SHA256 verification, R2 upload, remote existence, and remote size verification. Its Identity dump restored directly with PostgreSQL 15 `pg_restore` at exit 0 and without a `transaction_timeout` error.

## Disposable operator-email gate

- The reviewed correction executable ran only against the clean isolated PostgreSQL 15 fixture and exited 0 with status `corrected`. Output used a masked destination only. TENANT_ADMIN was preserved, one active session was revoked as expected, and `OPERATOR_EMAIL_CORRECTED` audit evidence was created.
- The canonical verifier executable exited 0 with `emailIdentifierCount=1`, `emailDestinationMatches=true`, `emailVerified=true`, and `tenantAdminPresent=true`. It used the tenant-scoped USERNAME to resolve the user, then the global EMAIL identifier; EMAIL is not tenant-filtered.
- The correction rerun exited 0 with status `already-compatible` and zero session, password-reset-token, invitation, and activation-challenge revocations. The verifier rerun exited 0 with the same required postconditions.
- The built verifier was proven fail-closed on disposable fixtures: unverified EMAIL, destination mismatch, missing EMAIL, missing TENANT_ADMIN, and ambiguous EMAIL each exited non-zero. Outputs were masked/safe and PostgreSQL tuple-write counters were unchanged for every verifier execution.
- Disposable PostgreSQL containers, networks, temporary SQL, and in-shell disposable credentials were removed after validation. No disposable database had a public port.

## Manual production regression

- Manual production remained authoritative and unchanged. Academic Web, Academic live, Academic ready (three consecutive checks), Manual Identity health, and Manual JWKS each returned HTTP 200.
- Manual ClamAV, Identity DB, and Academic DB were healthy. Exactly one manual notification worker and one manual sync worker were running.
- The private native Identity runtime remained a single main-process container; no native notification or sync worker was started. No canonical routing, domains, key storage, firewall, BL-002, maintenance state, password recovery, or production data was changed.

## Gate summary

- `PR3_MERGED=YES`
- `POST_MERGE_IDENTITY_CI=PASS`
- `NATIVE_IDENTITY_RUNTIME_NEW_SHA=PASS`
- `NATIVE_IDENTITY_KEY_GATE=PASS`
- `PRODUCTION_SHAPED_DISPOSABLE_RESTORE=PASS`
- `DISPOSABLE_IDENTITY_RESTORE_EXIT=0`
- `IDENTITY_EMAIL_CORRECTION_GATE=PASS`
- `IDENTITY_EMAIL_CANONICAL_VERIFIER=PASS`
- `IDENTITY_EMAIL_CORRECTION_IDEMPOTENCY=PASS`
- `IDENTITY_EMAIL_VERIFIER_FAIL_CLOSED=PASS`
- `PG15_BACKUP_TOOLING_GATE=PASS`
- `MANUAL_PRODUCTION_UNCHANGED=PASS`
- `IDENTITY_EMAIL_VERIFICATION_GATE_REVIEW=PASS`
- `MAINTENANCE_ENTERED=NO`
