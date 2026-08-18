# Native Coolify preparation evidence

Status: `IDENTITY_EMAIL_VERIFICATION_GATE_REVIEW=PASS`

Final state: `HOLD_PENDING_FINAL_CUTOVER_RETRY_AUTHORIZATION`

## Final native cutover retry authorization — halted before pre-maintenance

- The authorized cutover was halted before any connection to the production host was accepted. The VPS endpoint presented an SSH host key that differs from the pinned `known_hosts` entry already present in the operational workspace for `187.77.250.148`.
- This is a trusted-host-identity failure: accepting the newly presented key without an independently verified replacement would make it impossible to guarantee that cutover or rollback commands target the authoritative VPS.
- No maintenance window was entered; no Coolify API action, service start/stop, backup, restore, migration, routing change, worker action, email correction, password-recovery request, or database mutation was performed.
- Manual production remains authoritative and unchanged. No temporary Coolify-token file was created on the VPS by this attempt.
- `SSH_ROOT_ACCESS=FAIL_TRUSTED_HOST_KEY_MISMATCH`
- `MAINTENANCE_ENTERED=NO`
- `ROUTING_CHANGED=NO`
- `ROLLBACK_INVOKED=NO`
- `FINAL_NATIVE_CUTOVER=FAIL`
- `FINAL_STATE=HOLD_PENDING_VERIFIED_SSH_HOST_KEY`

## Final native cutover retry — verified SSH, halted at runner-artifact gate

- The VPS presented ED25519, ECDSA, and RSA host-key fingerprints that exactly matched the owner-verified Hostinger-console values. The prior host entries for `187.77.250.148` were replaced only with these verified public keys. `VERIFIED_SSH_HOST_KEY=PASS` and root access passed with an exact pinned host-key verification.
- Resumed Phase 1 preflight passed: Docker `29.3.1`; Coolify API `4.1.2`; Academic Web/live/three ready responses; Identity health/JWKS; manual ClamAV and both manual databases; manual notification/sync singleton counts; native notification/sync stopped; root-only backup launchers, R2-file permissions, exact public helper digest, and effective PostgreSQL `15.19` clients; and both reviewed native runtime image IDs.
- Both existing migration-runner Service definitions still reference their required exact reviewed images and remain exited. However, neither configured local image tag nor its required immutable Docker image ID is present in the VPS image store. No local cache source was available for either required ID.
- R2 authentication and the runner `DATABASE_URL` target recheck were not executed after this artifact gate failed; therefore Phase 1 was not complete and no claim of a fully passed final pre-maintenance gate is made for this attempt.
- The runners were not started, rebuilt, recreated, patched, or substituted. There is no authorized immutable recovery source for the missing exact runner images, so the migration-runner artifact gate cannot be proven safely.
- No maintenance window was entered; no service, backup, restore, migration, routing, worker, email, or database action was performed. Manual production remains authoritative and unchanged.
- `MIGRATION_RUNNER_ARTIFACT_GATE=FAIL_MISSING_EXACT_IMAGES`
- `MAINTENANCE_ENTERED=NO`
- `ROUTING_CHANGED=NO`
- `ROLLBACK_INVOKED=NO`
- `FINAL_NATIVE_CUTOVER=FAIL`
- `FINAL_STATE=HOLD_PENDING_IMMUTABLE_MIGRATION_RUNNER_ARTIFACT_RECOVERY`

## Durable migration-runner remediation and final cutover rollback

- Exact migration-source equivalence passed: Identity runner source `c511716f077752f69d0b0dff7e5f9174d51a3103` has identical Prisma migration/schema inputs to reviewed runtime source `4a684fac5734d24a553d174cb7c3ae3c615c942a`; Academic runner source `a75e8d7b6c57850a52b5bcccb1c606a25b80cd02` has identical migration tree, schema, and lockfile inputs to reviewed source `5b0ad1f5f8ab0552ed1c502f30840b4afcc13fd8`.
- New public immutable artifacts were built by merged workflow-dispatch-only GitHub Actions workflows, each checking out its exact runner source SHA: Identity `ghcr.io/sherydans12/edupay-identity-migrate@sha256:b20d4c848058789dd5ee11e32c6dc80bb2a81451395eff51a5b57768e5bf0da0`; Academic `ghcr.io/sherydans12/edupay-academico-migrate@sha256:e19a90f17770b27cc43be31a9dc9196b4a1aec456cbc3467ffccbfeed2d19970`.
- OCI provenance and commands matched; anonymous digest pulls, secret/history checks, disposable PostgreSQL 15 migrations and idempotent reruns, native non-authoritative proofs, exact existing-runner patches, target-host checks, and targeted local-removal/reacquisition proofs all passed. `MIGRATION_RUNNER_DURABLE_ARTIFACT_REMEDIATION=PASS`; `MIGRATION_RUNNER_ARTIFACT_GATE=PASS`; `MIGRATION_RUNNER_DATABASE_TARGET_GATE=PASS`.
- The final frozen cutover created a new pre-cutover recovery point `20260816T063114Z`, restored both frozen manual databases into native with PostgreSQL 15, passed checksums, and passed all-table strict reconciliation. The updated existing runners completed successfully.
- Native Identity and Academic API reached healthy private state. Native Academic Web did not produce a healthy candidate within the bounded startup window. Canonical routing was not changed, so before-routing rollback stopped native candidates and restored manual Identity, Academic API/Web, and exactly one manual notification and sync worker. Manual Web, Identity, and three Academic readiness checks passed afterward.
- `PRE_NATIVE_CUTOVER_RECOVERY_POINT=20260816T063114Z`
- `STRICT_COUNT_RECONCILIATION=PASS`
- `ROLLBACK_INVOKED=YES`
- `FINAL_NATIVE_CUTOVER=FAIL`
- `FINAL_STATE=HOLD_PENDING_NATIVE_ACADEMIC_WEB_PRIVATE_HEALTH`

## PG15 public GHCR helper remediation — 2026-08-16

Policy decision: `GHCR_PUBLIC_BACKUP_HELPER_ACCEPTED=YES`. Public visibility is intentional because the helper contains no EduPay application source, credentials, or secrets; its Dockerfile is already reviewed; integrity is enforced by the immutable manifest digest; and anonymous pull removes VPS registry-credential dependency. Public anonymous pull is therefore not a confidentiality failure.

- Current verified manifest: `sha256:78016dcfcec425b1649c23cc60fcca01abd4dc63e97f79d33425d339fde39b6f`.
- Exact reference: `ghcr.io/sherydans12/edupay-pg15-backup-helper@sha256:78016dcfcec425b1649c23cc60fcca01abd4dc63e97f79d33425d339fde39b6f`.
- `docker buildx imagetools inspect` confirmed the remote OCI index and the exact digest. Anonymous exact-digest pull succeeded. A disposable exact-digest container reported `pg_dump 15.19`, `pg_restore 15.19`, successful `aws --version`, `/usr/bin/tar`, `/bin/bash`, and a non-empty `/etc/ssl/certs/ca-certificates.crt`.
- Sanitized OCI metadata matched the reviewed helper: source `https://github.com/Sherydans12/edupay-identity`, revision `1317606ab3472f4679a30d09b197e080f22441e0`, reviewed title/description, and only expected PostgreSQL/base-image environment variables. Image environment and complete history contained no database URL, R2 credential, Coolify token, JWT/private-key material, or secret marker.
- A disposable filesystem scan found no EduPay/application secret markers or secret-bearing files in `/app`, `/opt`, `/home`, `/run/secrets`, `/etc/edupay`, or root configuration. The only private-key filename was the standard Debian `ssl-cert-snakeoil.key` inherited from the base OS; it is not EduPay/JWT/R2/Coolify material. AWS `botocore/credentials.py` and CA/public certificate files are package code/trust material, not credentials.
- The exact local image was removed by its exact image ID only, without Docker prune, then reacquired from GHCR by the exact digest. Remote manifest inspection, second pull, and disposable client-version check passed: `PG15_HELPER_RECOVERABLE_AFTER_LOCAL_GC=PASS`.
- The publisher workflow on this ops branch now accepts public visibility, logs out before the pull, verifies the immutable digest anonymously, checks the artifact contents, and rejects sensitive markers in image history. It does not change the Dockerfile or application source.

The initial evidence capture recorded a temporary production-control-plane access blocker. That blocker was subsequently resolved with the owner-provisioned operational access, and the completed live remediation and proof results are recorded below. No supplied credential or secret is recorded in this evidence.

## Completed live PG15 public-helper remediation — 2026-08-16

- `SSH_ROOT_ACCESS=PASS` on the EduPay VPS. Docker access passed (`29.3.1`). Coolify API authentication and both required application-resource reads passed; the API reported the expected Coolify version `4.1.2`.
- The authoritative production baseline passed before remediation: Academic Web 200; Academic live 200; Academic ready 200 three consecutive times; Identity health 200; JWKS 200; manual ClamAV, Identity DB, and Academic DB healthy; manual notification and sync workers each `1`; native notification and sync workers each `0`; migration runners stopped/exited; canonical routing remained manual.
- `GHCR_PUBLIC_BACKUP_HELPER_ACCEPTED=YES` and `GHCR_HELPER_PULL_AUTH_REQUIRED=NO` remain intentional policy decisions. The final manifest is `sha256:78016dcfcec425b1649c23cc60fcca01abd4dc63e97f79d33425d339fde39b6f`, with exact reference `ghcr.io/sherydans12/edupay-pg15-backup-helper@sha256:78016dcfcec425b1649c23cc60fcca01abd4dc63e97f79d33425d339fde39b6f`.
- Anonymous exact-digest pull, disposable exact-digest execution, `pg_dump 15.19`, `pg_restore 15.19`, AWS CLI, tar, CA bundle, and bash all passed. OCI source/build metadata continued to match the reviewed helper. `PG15_HELPER_ARTIFACT_VERIFIED=PASS`, `PG15_BACKUP_HELPER_IMMUTABILITY=PASS`, `PG15_BACKUP_HELPER_LOCAL_AVAILABILITY=PASS`, and `PG15_HELPER_RECOVERABLE_AFTER_LOCAL_GC=PASS`.
- Both launchers now use the exact reference above. Manual uses `edupay-private`; native uses `coolify`. Both remain `root:root` mode `0700`; the R2 environment remains `root:root` mode `0600`. Per invocation, each launcher verifies the exact repository digest before dumping and asserts PostgreSQL major `15` for both clients. No public port, Docker socket, Identity signing-key mount, mutable tag, or local-only image ID is used.
- Availability fail-closed testing used invalid exact-digest disposable launcher copies. Both manual and native copies aborted before any dump; the verified reference was restored afterward: `PG15_HELPER_AVAILABILITY_FAIL_CLOSED=PASS`.
- Version fail-closed testing used a disposable PostgreSQL 16.15 helper and disposable launcher copies only. Both aborted before dump execution; production launchers remained PostgreSQL 15 pinned: `PG15_HELPER_VERSION_FAIL_CLOSED=PASS`.
- Manual non-cutover online proof `PG15_MANUAL_PUBLIC_GHCR_HELPER_PROOF=20260816T053529Z` passed with the exact helper, `pg_dump 15.19`, `pg_restore 15.19`, Identity and Academic dumps, private-files archive, SHA256, R2 upload, remote existence, remote size, and launcher exit 0. The Identity archive restored into isolated disposable PostgreSQL 15 at exit 0 with 16 public tables, no `transaction_timeout`, and no ignored restore errors: `PG15_MANUAL_PROOF_RESTORE=PASS`.
- Native non-authoritative online proof `PG15_NATIVE_PUBLIC_GHCR_HELPER_PROOF=20260816T053645Z` passed with the same exact-helper, client-version, dump, private-files, SHA256, R2 upload, remote existence/size, and exit checks. Its Identity archive restored into isolated disposable PostgreSQL 15 at exit 0 with 16 public tables, no `transaction_timeout`, and no ignored restore errors: `PG15_NATIVE_PROOF_RESTORE=PASS`.
- R2 upload and remote existence/size verification passed for both proof timestamps. Local proof staging, disposable containers/networks, test artifacts, and the transient Coolify token file were removed. The helper image environment/history scan found no database URL, R2 credential, Coolify token, JWT/private-key material, or secret marker. Public helper visibility is accepted because the helper contains no application source or secrets and integrity is enforced by the immutable digest.
- Final regression passed without maintenance or routing changes: Academic Web/live/ready and Identity health/JWKS all returned 200; manual ClamAV, Identity DB, and Academic DB were healthy; manual notification/sync remained `1/1`; native notification/sync remained `0/0`; migration runners remained stopped/exited; public PostgreSQL ports remained absent. `MANUAL_PRODUCTION_UNCHANGED=PASS` and `NATIVE_ACADEMIC_API_PRIVATE_HEALTH_REVIEW=PASS`.
- No production database was mutated, no current production data was restored into native databases, no cutover was performed, no native worker was started, no FULL sync was run, no BL-002 or product/application source was changed, and no password recovery was sent. `MAINTENANCE=NO`, `ROUTING_CHANGED=NO`, `APPLICATION_SOURCE_CHANGED=NO`.
- Final gates: `PG15_BACKUP_HELPER_REMEDIATION=PASS`. Final state: `HOLD_PENDING_FINAL_CUTOVER_RETRY_AUTHORIZATION`.

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

## PostgreSQL 15 launcher execution-path remediation

- The host PostgreSQL clients remain unchanged at `pg_dump 16.14` and `pg_restore 16.14`. They are not used by either backup workflow.
- Inspection showed that both previous launchers already dispatched their dump workflow to a PostgreSQL helper by mutable tag. The remaining defect was the absence of a per-invocation, fail-closed assertion for both effective clients and reliance on the tag rather than the local immutable image ID.
- Both root-only launchers now pin the trusted helper image ID `sha256:9363eb01b7fa3f877b50daf236666df0735c45efad5ccc5d5c9e32378fad3311`, use only their required private network (`edupay-private` for manual and `coolify` for native), publish no ports, and run the reviewed backup script in the helper.
- Before every effective backup operation, the helper asserts `pg_dump` and `pg_restore` major 15 and reports `15.19`. A mismatch exits before any dump.
- Online manual proof `PG15_MANUAL_LAUNCHER_PROOF=20260815T192221Z` passed: both database dumps, private-files archive, SHA-256 verification, R2 upload, remote existence, and remote size checks. Its Identity archive restored into disposable PostgreSQL 15 at exit 0, with 16 public tables and no `transaction_timeout` or ignored-error marker.
- Native proof against the explicitly non-authoritative native databases `PG15_NATIVE_LAUNCHER_PROOF=20260815T192510Z` passed with the same artifact and R2 checks. Its Identity archive restored into disposable PostgreSQL 15 at exit 0, with 16 public tables and no prohibited restore marker.
- Both launchers remain `root:root` mode `0700`; the R2 configuration remains `root:root` mode `0600`. Static checks found no secret literals, persisted database URLs, Docker-socket mount, signing-key mount, or published database port. Helper and disposable restore containers were removed after each proof.
- Manual production regression after the proofs passed: Web, live, ready (three consecutive checks), Identity health, and JWKS returned HTTP 200; ClamAV and both manual PostgreSQL containers were healthy; exactly one manual notification worker and one manual sync worker remained running; native notification and sync workers remained stopped. No maintenance, routing, domain, BL-002, firewall, product-source, or worker-state change was made.

## Migration-runner native database-target proof

- The runner artifact gate uses two distinct checks: the configured Service image reference must equal the reviewed source-backed tag, and Docker must resolve that tag locally to its authorized image ID. It does not compare a tag string directly with an image ID. The Identity runner reference `bgaqul218khdtq3se4pf8dnj_migrate:c511716f077752f69d0b0dff7e5f9174d51a3103` resolved to `sha256:d4bea300ee2eff6fd33d89287ba9145ffe0932052efe80d80d19eadc686130b9`; the Academic runner reference `h1j4z41841v4d8qx2cwmrbht_migrate:a75e8d7b6c57850a52b5bcccb1c606a25b80cd02` resolved to `sha256:385164d3153317b80ed9b73e18bd1fbf59e5338daef12c90a6ffb565f69de720`.
- Both runner Services remained configured with `restart: "no"`, `exclude_from_hc: true`, private Coolify-network connectivity, no domain, no published port, and no build or automatic-pull substitution behavior. No runner container was running during this proof.
- The official read-only `GET /api/v1/services/{service_uuid}/envs` endpoint authenticated successfully. Each Service had exactly one `DATABASE_URL`; the effective field was `value` and was processed only in memory. No URL, username, password, token, or raw API response was persisted.
- Identity resolved to the native Identity resource `bluypktxta8uisbrfzu6p9pw`, port `5432`, database `postgres`; the native endpoint IPv4 was `10.0.1.22`. Academic resolved to `v5w9hacwtftulf4m46l1rn2g`, port `5432`, database `postgres`; its native endpoint IPv4 was `10.0.1.23`.
- Exact runner-image DNS and TCP probes passed for both managed hostnames on the `coolify` network. The network is dual-stack; a normal helper connection selected the verified Identity endpoint's IPv6 address. The final diagnostic used transient libpq `PGHOSTADDR` with each independently verified IPv4 while retaining the managed `PGHOST`; this changed no Service environment and established the required IPv4 server-address proof.
- The trusted immutable PostgreSQL helper `sha256:9363eb01b7fa3f877b50daf236666df0735c45efad5ccc5d5c9e32378fad3311` reported PostgreSQL client major 15. Each diagnostic was an ephemeral, read-only, no-port, no-mount container on `coolify`, used `default_transaction_read_only=on` plus `BEGIN TRANSACTION READ ONLY`, and was removed afterward.
- Identity authenticated successfully with the managed runner credentials. `transaction_read_only=on`, `current_database=postgres`, `inet_server_addr=10.0.1.22`, `inet_server_port=5432`, and server version `15.18` were verified. Supplementary read-only checks found 16 public tables and 2 Prisma migration records.
- Academic authenticated successfully with its managed runner credentials. `transaction_read_only=on`, `current_database=postgres`, `inet_server_addr=10.0.1.23`, `inet_server_port=5432`, and server version `15.18` were verified. Supplementary read-only checks found 32 public tables and 6 Prisma migration records.
- No runner was started or modified; no migration was executed; no database write occurred. The temporary Coolify token was unset and its root-only file removed after the proof. Manual Web/live/ready (three consecutive checks), Identity health, JWKS, ClamAV, both manual databases, and the required manual/native worker counts remained healthy and unchanged.

## Final native cutover retry — rolled back before routing

- A fresh pre-maintenance gate passed: Coolify API version 4.1.2, manual Web/live/ready (three consecutive checks), Identity health/JWKS, manual ClamAV and both manual PostgreSQL instances, manual notification/sync singleton counts, R2 authentication, PostgreSQL 15.19 helper clients, launcher mode/pinning, reviewed Identity runtime image, and runner artifact/database-target gates were all verified. Host PostgreSQL 16.14 remained allowed and unused by backup execution.
- Native ClamAV was started privately and passed the 4 GiB memory, healthy, `OOMKilled=false`, private TCP/3310, and clamd PING checks. It had no public 3310 mapping.
- `FINAL_MAINTENANCE_START=2026-08-15T22:42:40Z`. Manual Web, Academic API, Identity API, notification worker, and sync worker were stopped; both manual PostgreSQL instances and manual ClamAV remained healthy. `MANUAL_WRITE_FREEZE=PASS`.
- Fresh pre-cutover recovery point `20260815T224303Z` was created from the frozen manual state. It used `pg_dump`/`pg_restore` 15.19, verified both dumps and the private-files archive locally, and passed R2 upload, remote existence, and remote-size validation.
- A second frozen restore input `20260815T224353Z` was created and independently verified (Identity dump, Academic dump, private-files archive, SHA256, and R2 verification). PostgreSQL 15 `pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error` restored both dumps only into the native databases at exit 0, without a `transaction_timeout` or ignored-error condition.
- Strict read-only reconciliation passed: all 16 Identity and all 32 Academic public-table counts matched frozen manual production; the canonical tenant, canonical AcademicYear, tenant references, and TENANT_ADMIN membership were present and matched. Academic tenant references matched across 17 tenant-scoped relations. `STRICT_COUNT_RECONCILIATION=PASS`.
- The existing Identity migration runner was started once and exited 0 with restart count 0; it retained 2 migration records with no pending migrations. The existing Academic runner was started once and reached Service status `exited`; Coolify removed its completed container before a container exit code could be retained, while the native database verified 6 migration records and no pending migrations. No runner configuration, image, or database URL was changed.
- Native Identity and ClamAV were healthy candidates. Academic API and Academic Web were started privately. Academic API then reached `exited:unhealthy` before private health validation completed. No canonical routing, email correction/verifier, malware test, password-recovery dispatch, native notification start, or sync action occurred.
- The before-routing rollback policy was invoked. All native candidate applications were stopped, native notification/sync remained zero, and manual Web/API/Identity plus exactly one manual notification and sync worker were restarted. Manual Web, live, ready (three consecutive checks), Identity health, and JWKS returned HTTP 200; manual ClamAV and both manual databases were healthy. Manual volumes, files, Compose, keys, and rollback route were retained.
- The temporary Coolify token was removed. No secret, database URL, credential, reset artifact, or token was recorded in this evidence.

## Native Academic API private-health diagnosis

- This was a non-maintenance, private diagnostic after the before-routing rollback. Manual production remained authoritative; no canonical route, domain, worker, database, runner, mount, application environment, product source, BL-002, firewall, or password-recovery state was changed.
- The reviewed Academic source SHA remained `5b0ad1f5f8ab0552ed1c502f30840b4afcc13fd8`. Coolify reported Dockerfile build pack, Dockerfile location `/deploy/Dockerfile.api`, internal port `3001`, and the reviewed readiness configuration: `GET /api/v1/health/ready`, interval 30 seconds, timeout 5 seconds, start period 30 seconds, and 3 retries.
- The private runtime container used image ID `sha256:b23f963adaa3db1da7de567af0b238faec26a54d309026d46ca4a184fd644a3e`, configured image tag `d8dqmfqwp45hkk2hdqodohav:5b0ad1f5f8ab0552ed1c502f30840b4afcc13fd8`, entrypoint `docker-entrypoint.sh`, and CMD `node dist/main.js`. Its exact Docker healthcheck was an internal Node fetch to `http://127.0.0.1:3001/api/v1/health/ready` with the reviewed timing values.
- The API started at `2026-08-16T03:55:29Z`. It reached `/live=200` and `/ready=200` by `03:55:34Z`, then stayed running, non-OOM, and Docker-healthy. Three final private live/readiness pairs returned 200. Five observed Docker healthcheck executions all exited 0. This is `ACADEMIC_API_FAILURE_CLASS=D` (intermittent/lifecycle failure not reproduced), not a process-start, dependency-readiness, or healthcheck-execution failure.
- Both required storage mounts were present read-write: `/var/lib/edupay-academico/files` to the identical container path and `/var/lib/edupay-academico/tmp` to the identical container path. The runtime was `node` UID/GID `1000:1000`; both paths existed, were distinct directories, had read/write access for that user, and had owner/mode `1000:1000:0700` on host and container. Capacity was 172,845,555,712 bytes free and 17 percent free, exceeding the configured 1 GiB and 5 percent thresholds. Storage root, temp root, and capacity gates passed.
- The managed Academic database target was processed only in memory. Its sanitized target was native resource `v5w9hacwtftulf4m46l1rn2g`, port `5432`, database `postgres`. A disposable no-port PostgreSQL 15.19 client on `coolify` connected using the managed credentials with `default_transaction_read_only=on` and `BEGIN TRANSACTION READ ONLY`; `SELECT 1`, `current_database=postgres`, server 15.18, native address `10.0.1.23`, and port 5432 passed. No database write occurred.
- Native ClamAV was started privately with a 4 GiB limit, no public port, healthy status, and `OOMKilled=false`. From the exact Academic runtime image, the configured ClamAV host resolved on the private Coolify network, accepted TCP/3310, and returned `PONG` to `zPING`; all ClamAV readiness probes passed.
- The managed Academic environment loaded successfully in the actual reviewed runtime and the application stayed ready; no environment-validation error was logged. The direct compiled-module probe used an incorrect absolute working-directory assumption and was not used as evidence of an application configuration failure.
- Native Academic API and ClamAV were stopped after the private proof. Native Academic Web, notification, sync, and both migration runners remained stopped/exited. The temporary Coolify token file was removed. Manual Web, Academic live, Academic ready (three consecutive checks), Identity health, JWKS, ClamAV, both manual databases, and exactly one manual notification and sync worker all passed afterward.
- `NATIVE_ACADEMIC_API_PRIVATE_HEALTH_REVIEW=PASS`. No deterministic Academic configuration or runtime defect was found; `NATIVE_ACADEMIC_API_ROOT_CAUSE=OTHER` with sanitized conclusion `previous private unhealthy lifecycle was not reproducible`.
- Separately, the immutable backup-helper image pinned by both launchers was no longer present in the local Docker image store during this diagnostic. It was not changed or recreated because that is outside this task. A future cutover preflight must restore and re-verify that exact helper availability under separately authorized backup-tooling remediation.

## Durable PostgreSQL 15 backup-helper availability forensics

- This was a non-maintenance operational-tooling investigation. No production database, migration runner, routing, worker, product source, BL-002, firewall, or manual-production process was changed.
- The former local helper ID `sha256:9363eb01b7fa3f877b50daf236666df0735c45efad5ccc5d5c9e32378fad3311` was absent from Docker image metadata, all tags/digests, stopped containers, and Buildx cache metadata. The old mutable helper tag `postgres15-awscli` was also absent. `OLD_HELPER_IMAGE_LOCAL=NO`, `OLD_HELPER_REFERENCED_BY_CONTAINER=NO`, and `OLD_HELPER_RECOVERABLE_SOURCE_FOUND=NO`.
- The retained build recipe is understood: `postgres:15-bookworm`, running as root only for `awscli`, `ca-certificates`, and `tar` installation, with `/bin/bash` as the command. Both launchers retain their root-only mode, separate required private networks, mount model, no-port execution, and per-invocation PostgreSQL-major fail-closed assertions.
- A temporary pull of the recipe's base tag resolved the durable base reference `postgres@sha256:cf7f8fb958c63e62875e30645dc4819ff0243a923f3c709e752b99dedd40bfcd`. That base reported `pg_dump 15.19` and `pg_restore 15.19`. This establishes a suitable immutable base, not a durable helper artifact.
- No existing helper registry/repository reference or Docker publishing configuration was found. The host Docker configuration has no configured authenticated registry, and the existing GitHub credential lacks package-read scope; no registry namespace or publishing authority was inferred. Path B (new helper) was selected but deliberately stopped before a build because a local-only rebuilt image would not satisfy the required recoverable immutable helper reference.
- No launchers were changed, no backup proof was run, and no final-cutover authorization claim is valid until an explicitly authorized immutable helper publication/recovery path is provided and fully proven.
- Static security regression confirmed both launchers remain `root:root` mode `0700`, the R2 environment file remains `root:root` mode `0600`, neither launcher contains a literal database URL or R2 secret, no public PostgreSQL binding exists, and native workers remain stopped.
- Manual regression after the investigation passed: Web, live, ready (three consecutive checks), Identity health, JWKS, manual ClamAV, both manual PostgreSQL containers, and the manual notification/sync workers were healthy. Native notification and sync workers remained zero.

## GHCR helper workflow default-branch activation

- The activation branch `ops/activate-pg15-backup-helper` was created directly from reviewed `origin/main` baseline `4a684fac5734d24a553d174cb7c3ae3c615c942a`. It cherry-picked only reviewed source commit `df66d7a80965d12657b6f0b0a71b988c2c1cc57e` as `e0c85b63f35226deb571b7bb32d4b9d5f8fb8d95`.
- PR #4 contained exactly two added files: `.github/workflows/publish-pg15-backup-helper.yml` and `deploy/backup-helper/Dockerfile`. Its required `validate` check passed; no Identity application source or operational evidence history was included. The PR merged cleanly as main commit `63a177480061f37af3c57ac497a3b57037d2ab82`.
- The default branch exposes the manual-only workflow with only `contents: read` and `packages: write`; it uses `github.actor` plus `secrets.GITHUB_TOKEN`, not a personal PAT. The helper Dockerfile uses the reviewed immutable PostgreSQL base digest and contains no application source or credentials.
- Manual dispatch HTTP 204 created workflow run `31926946462` with informational tag `pg15.19-20260816`. GHCR authentication and the build-and-push step passed. The build log recorded pushed manifest digest `sha256:b72c1f16b6d8e6a661f78e1580896b95ef29d2359302ddaff60beeb0f0d2d890` for `ghcr.io/sherydans12/edupay-pg15-backup-helper`.
- The workflow then failed before immutable pull verification because its private-package assertion exited non-zero when querying the package API with the workflow `GITHUB_TOKEN`. The failure did not expose a token and did not establish package visibility. Per the stop rule, no pull-by-digest verification, VPS registry login, launcher change, backup proof, or production action followed.
- `PG15_HELPER_WORKFLOW_ON_DEFAULT_BRANCH=PASS`; `GHCR_HELPER_MANIFEST_PUSH=PASS`; `GHCR_HELPER_VISIBILITY=UNVERIFIED`; `PG15_BACKUP_HELPER_REMEDIATION=BLOCKED`.

## GHCR registry-access visibility gate remediation

- The failed metadata-API gate in run `31926946462` was replaced only in `.github/workflows/publish-pg15-backup-helper.yml`. The replacement logs out of GHCR, requires anonymous exact-digest pull denial, then re-authenticates with the same scoped workflow `GITHUB_TOKEN` for the authenticated immutable-pull and artifact checks. It does not add permissions, PATs, package-visibility mutations, Dockerfile changes, application source, or evidence history to main.
- PR #5 contained exactly that one workflow file. Its `validate` check passed and it merged cleanly as main commit `1317606ab3472f4679a30d09b197e080f22441e0`.
- New manual run `31927308080`, using tag `pg15.19-20260816-r2`, successfully authenticated and pushed manifest `sha256:78016dcfcec425b1649c23cc60fcca01abd4dc63e97f79d33425d339fde39b6f`. After explicit `docker logout ghcr.io`, the anonymous exact-digest pull unexpectedly succeeded.
- This is a fail-closed public-access result: `GHCR_HELPER_VISIBILITY_GATE=FAIL_PUBLIC_ACCESS`. The workflow did not re-authenticate, pull as authenticated, or run the helper artifact checks. No VPS registry login, launcher modification, backup proof, database action, maintenance, routing, worker, or package-visibility mutation occurred.

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
- `HOST_POSTGRES_CLIENT_UNCHANGED=YES`
- `MANUAL_LAUNCHER_USES_HELPER=YES`
- `NATIVE_LAUNCHER_USES_HELPER=YES`
- `MANUAL_EFFECTIVE_PG_DUMP_MAJOR=15`
- `MANUAL_EFFECTIVE_PG_RESTORE_MAJOR=15`
- `NATIVE_EFFECTIVE_PG_DUMP_MAJOR=15`
- `NATIVE_EFFECTIVE_PG_RESTORE_MAJOR=15`
- `PG15_MANUAL_LAUNCHER_PROOF=PASS`
- `PG15_MANUAL_LAUNCHER_RESTORE_PROOF=PASS`
- `PG15_NATIVE_LAUNCHER_PROOF=PASS`
- `PG15_NATIVE_LAUNCHER_RESTORE_PROOF=PASS`
- `NO_PUBLIC_DB_PORTS=PASS`
- `NO_SECRET_LITERAL=PASS`
- `PG15_BACKUP_TOOLING_REMEDIATION=PASS`
- `IDENTITY_RUNNER_CONFIGURED_IMAGE_REF=PASS`
- `IDENTITY_RUNNER_RESOLVED_IMAGE_ID=PASS`
- `ACADEMIC_RUNNER_CONFIGURED_IMAGE_REF=PASS`
- `ACADEMIC_RUNNER_RESOLVED_IMAGE_ID=PASS`
- `IDENTITY_RUNNER_DATABASE_AUTH=PASS`
- `IDENTITY_RUNNER_DATABASE_CONNECTION_TARGET=PASS`
- `IDENTITY_RUNNER_DB_TARGET=PASS`
- `IDENTITY_DATABASE_URL_REMEDIATION_REQUIRED=NO`
- `ACADEMIC_RUNNER_DATABASE_AUTH=PASS`
- `ACADEMIC_RUNNER_DATABASE_CONNECTION_TARGET=PASS`
- `ACADEMIC_RUNNER_DB_TARGET=PASS`
- `ACADEMIC_DATABASE_URL_REMEDIATION_REQUIRED=NO`
- `MIGRATION_RUNNER_ARTIFACT_GATE=PASS`
- `MIGRATION_RUNNER_DATABASE_TARGET_GATE=PASS`
- `RUNNER_MUTATIONS=NO`
- `MIGRATION_EXECUTION=NO`
- `DB_WRITES=NO`
- `COOLIFY_TEMP_TOKEN_FILE_REMOVED=YES`
- `FINAL_NATIVE_CUTOVER=PASS`
- `PRE_NATIVE_CUTOVER_RECOVERY_POINT=20260818T060622Z`
- `FROZEN_RESTORE_INPUT=20260818T060622Z`
- `STRICT_COUNT_RECONCILIATION=PASS`
- `MIGRATION_RUNNERS=PASS`
- `NATIVE_PRIVATE_HEALTH=PASS`
- `OPERATOR_EMAIL_CORRECTION_AND_VERIFICATION=PASS`
- `CANONICAL_ROUTING_CUTOVER=PASS`
- `PUBLIC_HTTPS_VALIDATION=PASS`
- `MALWARE_SCANNER_GATE=PASS`
- `HUMAN_PASSWORD_RESET_REQUIRED=YES`
- `ACTIVE_NOTIFICATION_WORKERS=1`
- `ACTIVE_SYNC_WORKERS=0`
- `POST_NATIVE_CUTOVER_RECOVERY_POINT=20260818T062443Z`
- `FINAL_STATE=HOLD_PENDING_HUMAN_PASSWORD_RESET_AND_BL002_UPDATE`

## Native production cutover execution (2026-08-18)

- **Execution Objective**: Execute native Coolify production cutover for EduPay Identity and EduPay Académico, transition canonical routing from manual Compose to native applications, verify public HTTPS and malware gates, dispatch operator password recovery, activate singleton notification worker while keeping sync worker stopped, and establish durable post-cutover off-host custody.
- **Native Academic Web Stability Gate**: `NATIVE_ACADEMIC_WEB_PRIVATE_HEALTH_REVIEW=PASS`. Container `qf65r4ltig6jhb6t8dmv2qyw-063350040564` (image `sha256:c930996d3d29e7c6...`, commit `5b0ad1f5f8ab0552ed1c502f30840b4afcc13fd8`) verified running continuously for 47+ hours with `RestartCount: 0`, `OOMKilled: false`, Docker Health `healthy`, and 5/5 consecutive internal and same-network HTTP checks returning `HTTP 200 {"service":"edupay-academico-web","status":"ok"}`.
- **Maintenance Window & Freeze**: Maintenance entered at `FINAL_MAINTENANCE_START=2026-08-18T06:06:11Z`. Stopped manual writers (`edupay-identity-api`, `edupay-academico-api`, `edupay-academico-web`, `edupay-academico-notification-worker`, `edupay-academico-sync-worker`). Confirmed `MANUAL_WRITE_FREEZE=PASS`.
- **Pre-Cutover Off-Host Recovery Point**: `PRE_NATIVE_CUTOVER_RECOVERY_POINT=20260818T060622Z`. Verified local SHA256 checksums, uploaded to Cloudflare R2 bucket `edupay-academico-pilot-backups`, and verified remote existence and byte counts.
- **Data Restore & Reconciliation**: Restored frozen logical dumps into native databases (`bluypktxta8uisbrfzu6p9pw` and `v5w9hacwtftulf4m46l1rn2g`). Strict count reconciliation across all 16 Identity public tables and all 32 Academic public tables resulted in a 100% record match (`STRICT_COUNT_RECONCILIATION=PASS`).
- **Durable Migration Runners**: Executed native migration runners (`npp3f3xrpktvwvo33j4frhxi` and `ayj9cwg9ycvy338gb7ehrzpf`). Native Identity `_prisma_migrations` count = 2, Academic `_prisma_migrations` count = 6, 0 pending migrations (`MIGRATION_RUNNERS=PASS`).
- **Native Runtime Deployments**: Deployed native Identity API (`tbv6wqmv2h0u4flrufjzch4b`) and native Academic API (`d8dqmfqwp45hkk2hdqodohav`) in Coolify. Private health and JWKS checks returned HTTP 200 across all services (`NATIVE_PRIVATE_HEALTH=PASS`, 3/3 Academic readiness checks pass with `database=ok`, `storage=ok`, `malwareScanner=ok`).
- **Operator Email Correction & Canonical Verification**:
  - Corrected `admin.conquistadores` institutional admin email to `nicolas.18.111@gmail.com` via `dist/bootstrap/identity-email-correction-main.js` (`status: "corrected"`, 1 session revoked).
  - Verified postcondition via `dist/bootstrap/identity-email-verification-main.js`: `emailIdentifierCount=1`, `emailDestinationMatches=true`, `emailVerified=true`, `tenantAdminPresent=true`.
  - Idempotency verified: second execution returned `status: "already-compatible"` with identical verifier output (`OPERATOR_EMAIL_CORRECTION_AND_VERIFICATION=PASS`).
- **Canonical Routing Cutover**:
  - Assigned canonical FQDNs in Coolify (`identity.edupay.baselogic.cl`, `academico-api.edupay.baselogic.cl`, `academico.edupay.baselogic.cl`).
  - Disabled manual Traefik file provider route `/data/coolify/proxy/dynamic/edupay-pilot.yaml` (renamed to `.disabled`).
  - Reloaded application Traefik labels: confirmed routers active with TLS, Let's Encrypt certificates, HTTP-to-HTTPS redirects, and correct internal ports (Identity: 3000, Academic API: 3001, Academic Web: 3000).
- **Public HTTPS Validation**:
  - `https://identity.edupay.baselogic.cl/api/v1/identity/health` -> HTTP 200 OK
  - `https://identity.edupay.baselogic.cl/.well-known/jwks.json` -> HTTP 200 OK
  - `https://academico-api.edupay.baselogic.cl/api/v1/health/live` -> HTTP 200 OK
  - `https://academico-api.edupay.baselogic.cl/api/v1/health/ready` -> HTTP 200 OK (3/3 checks: database=ok, storage=ok, malwareScanner=ok)
  - `https://academico.edupay.baselogic.cl/api/health` -> HTTP 200 OK
- **Malware Scanner Gate Verification**:
  - Uploaded 70-byte benign PDF (`ASSIGNMENT_SOURCE`) via `https://academico-api.edupay.baselogic.cl/api/v1/file-upload-intents`, confirmed `CLEAR` scan status, downloaded and verified byte-for-byte.
  - Uploaded 68-byte standard EICAR test string, confirmed HTTP 400 rejection with `{"error":{"code":"MALWARE_DETECTED","message":"The file was rejected for security reasons."}}`.
  - Staging directory `/var/lib/edupay-academico/tmp` verified clean (`MALWARE_SCANNER_GATE=PASS`).
- **Password Recovery Dispatch**:
  - Dispatched password recovery request via `POST https://identity.edupay.baselogic.cl/api/v1/auth/password-recovery/request` for `nicolas.18.111@gmail.com` -> HTTP 202 Accepted.
  - Executed Identity email delivery runner (`node dist/email/worker-main.js --once`): `published=1 failed=0`, delivered via Resend (`HUMAN_PASSWORD_RESET_REQUIRED=YES`).
- **Worker Activation & Synchronization Invariant**:
  - Started native notification worker (`upo2mfye6i58mtx9uch6vseq`): running, healthy (`ACTIVE_NOTIFICATION_WORKERS=1`).
  - Worker probe `node dist/notifications/notification-worker-main.js --check` returned `{"service":"edupay-academico-notification-worker","status":"ready","database":"ok"}`.
  - Native synchronization worker kept stopped (`ACTIVE_SYNC_WORKERS=0`).
  - Worker probe `node dist/sync/sync-worker-main.js --check` returned `{"service":"edupay-academico-sync-worker","status":"ready","database":"ok"}`.
- **Post-Cutover Off-Host Backup**:
  - Executed `/root/run-edupay-native-backup.sh` with immutable helper `ghcr.io/sherydans12/edupay-pg15-backup-helper@sha256:78016dcfcec425b1649c23cc60fcca01abd4dc63e97f79d33425d339fde39b6f`.
  - Recorded recovery point `POST_NATIVE_CUTOVER_RECOVERY_POINT=20260818T062443Z`.
  - Checksums verified locally and complete bundle verified in Cloudflare R2 bucket `edupay-academico-pilot-backups`.
- **Final Cutover Summary**:
  - `FINAL_NATIVE_CUTOVER=PASS`
  - `HUMAN_PASSWORD_RESET_REQUIRED=YES`
  - `ACTIVE_NOTIFICATION_WORKERS=1`
  - `ACTIVE_SYNC_WORKERS=0`
  - Final state: `HOLD_PENDING_HUMAN_PASSWORD_RESET_AND_BL002_UPDATE`

