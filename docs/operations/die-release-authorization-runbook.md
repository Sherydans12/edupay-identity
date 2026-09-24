# EduPay DIE release authorization runbook

Status: **completed under the operator authorization dated 2026-09-24**. The
procedure below is retained as the pre-release approval snapshot; do not execute
it again as a current runbook.

## Identity release result — 2026-09-24

- Identity PR #12 merged at `9ab29bf5edaa0cd780d5f8912441c1735e51d91a`, from
  approved candidate `93418b68eaf41976b4bc695039afcbc8eab4fdbc`. Its required
  CI `validate` passed before merge.
- Active Coolify resource: `0vrvqepcukwcubxga0narorf`. Runtime artifact:
  `ghcr.io/sherydans12/edupay-identity@sha256:960d326a9199881d54c7fc9611d052be77c0fbdceae4badebfe1208febe5aa01`.
- The release migration runner was
  `ghcr.io/sherydans12/edupay-identity-migrate@sha256:ad9edaa31bf01d4916846527041eadd65310ce21454bfb4d419d4ca2bfba9363`.
  The earlier runner with local image ID
  `fa88615b0d08abf807ad4667b2812326648fa855aacc6221bb752b35cf2409b7` was
  retired because it lacked `schema-engine`.
- Identity applied only `20260924000000_add_staff_role`, checksum
  `efdf76787689aeb4b765d743cec5501bd5d7c9b33be1d095975a73b484d5c87e`. The
  ledger is four completed migrations; all three historical rows and checksums
  remain, including
  `20260831000000_provisioning_idempotency_receipts` at checksum
  `c615b7fd9db0ea642ad08fa5981f498dd9a73e97b9db7c0d2d0d2d7cd53eb68b`. That
  historical migration was not reapplied or resolved.
- The joint recovery point was `20260924T010020Z`; Identity source was Coolify
  PostgreSQL resource `bluypktxta8uisbrfzu6p9pw`, database `postgres`, schema
  `public`, with three ledger rows before migration.
- Health, public/private JWKS, private S2S connectivity and the controlled
  synthetic nonexistent-username rejection were verified. No account,
  membership, secret rotation, or real pilot data was created. The scheduler
  and outbox returned with the runtime; no historical event was replayed.
- Academic continues to consume Identity over the existing private Coolify
  network. Manual deploy and the existing network hook remain in use; no public
  S2S bypass was added. The module is deployed, while pilot setup and validation
  remain the user's next step.

The companion release closeout and pilot guide are in
[Académico operations documentation](https://github.com/Sherydans12/edupay-academico/blob/main/docs/operations/die-release-closeout-2026-09-24.md).

## Pre-release authorization snapshot (historical; do not execute)

The steps below record the plan that was reviewed before authorization. Their
approval block is historical, not a request for another approval.

## Fixed release inputs

- Identity PR #12 candidate: use the exact SHA in the accompanying operational
  package manifest and reverify against the live PR head before release.
- Académico PR #10 candidate: `bd413666ebb3674dc791d8cb735bcea1aadbed62`;
  reverify against the live PR head before release.
- Identity production history: the three completed migrations are
  `20260808000000_identity_foundation`,
  `20260809000000_account_lifecycle`, and
  `20260831000000_provisioning_idempotency_receipts`.
- The receipts migration checksum is
  `c615b7fd9db0ea642ad08fa5981f498dd9a73e97b9db7c0d2d0d2d7cd53eb68b`; its
  tracked SQL is byte-identical to the production checksum. It must be present
  in the final migration image, but is already applied in production.
- The only pending Identity migration is
  `20260924000000_add_staff_role` (`efdf76787689aeb4b765d743cec5501bd5d7c9b33be1d095975a73b484d5c87e`).
- Académico applies exactly these three migrations in order:
  `20260922120000_die_educational_inclusion`,
  `20260923120000_tenant_operational_profile`,
  `20260924120000_die_staff_members`.
- Production has no STAFF enum value and no DIE tables or data. Do not use this
  release to create STAFF users, memberships, institutional profiles, or DIE
  records.

## Before the maintenance window

1. Re-fetch both PRs and confirm their head SHAs and green required CI match the
   fixed inputs in the accompanying operational package. Stop if either head moved; update and re-review this
   procedure before release.
2. Publish runtime, migration runners, and Academic FRONT from the approved
   SHAs through the manual workflows. Use immutable SHA tags. Inspect each
   remote registry digest and record the actual GHCR reference; a local Docker
   image ID is not a registry digest. Keep automatic deploy disabled.
3. Read the Coolify inventory and confirm the existing Identity private-network
   hook remains enabled. No direct Compose recreation is permitted.
4. Confirm the following configuration names exist without printing values:
   - Académico API: `IDENTITY_INTERNAL_BASE_URL`,
     `IDENTITY_INTERNAL_SERVICE_TOKEN`, `IDENTITY_INTERNAL_TIMEOUT_MS`.
   - Identity: `IDENTITY_ACADEMICO_SERVICE_TOKEN`,
     `IDENTITY_ACADEMICO_SERVICE_TOKEN_PREVIOUS`,
     `IDENTITY_ACADEMICO_SERVICE_TOKEN_PREVIOUS_EXPIRES_AT`.
   Confirm the current server-side tokens agree. Do not rotate them unless the
   operator explicitly includes a rotation in the authorization; if rotated,
   use Coolify secrets and the documented overlap of at most 24 hours.
5. Start the maintenance window and freeze writes. Take and verify one recovery
   point containing custom-format dumps for both PostgreSQL databases, the
   private Academic file volume, a non-secret configuration inventory, and
   checksums present in R2. Stop if any component, checksum, or R2 verification
   is missing.
6. Run the packaged read-only `identity-preflight.sql` and
   `academic-preflight.sql`. Identity must show exactly the three completed
   historical rows, their expected checksums, no `STAFF`, and no unexpected
   migration. Académico must show its ten historical rows and no unexpected
   migration or pre-existing DIE table. Abort on any mismatch; never use
   `prisma migrate resolve` to hide one.

## Authorized execution order

1. Merge Identity PR #12 at its approved final SHA.
2. Run a new release-scoped Identity migration runner in the Coolify private
   network. It must apply only `20260924000000_add_staff_role`; do not reapply
   or resolve the already-applied receipts migration.
3. Verify the Identity ledger now has four completed migrations, preserves all
   three prior checksums, and contains the `STAFF` enum label.
4. Manually redeploy Identity through Coolify so its private-network hook runs.
   Verify healthy runtime, private database/network connectivity, health/JWKS,
   `401` without S2S auth, and the documented generic response for a synthetic
   nonexistent username using the current S2S credential. Do not create a real
   STAFF account.
5. Merge Académico PR #10 at its approved final SHA.
6. Run a new release-scoped Académico migration runner. Apply DIE, tenant
   operational profile, and STAFF-member migrations in that order. Verify the
   original ten checksums and private file inventory, backfill count, ledger
   count thirteen, and zero invented tenant profiles.
7. Manually redeploy Académico API. Verify live/ready health, database and
   private storage, scanner readiness, and `401` from DIE/export and general
   file-download routes without authentication.
8. Manually deploy Academic FRONT after API health. Verify `/api/health`, login,
   and the public canonical API and Identity base URLs.
9. Keep notification/sync workers and ClamAV unchanged. Do not enable BL,
   replay historical outbox work, or create pilot data. Lift the write freeze
   only after all approved resources are healthy.

If any checkpoint fails, stop the sequence and keep the maintenance controls in
place. Use the resource-specific recovery guidance in the approved DIE
readiness package. Do not roll back database migrations or delete files.

## Operator approval block

The operator should approve this exact block after reviewing the final package
and real remote image digests:

> I authorize merge of Identity #12 and Académico #10 at the exact SHAs listed
> in the accompanying operational package manifest, publication of their immutable
> runtime/migration/FRONT artifacts and recording of the verified registry
> digests, a verified joint database/storage recovery point, application of
> Identity `20260924000000_add_staff_role` only, followed by Identity Coolify
> redeploy, application of Académico migrations 11–13 in the order above,
> Académico API redeploy, then FRONT deploy. I authorize verification of the
> listed configuration names and matching current S2S credential without
> exposing secret values. This does not authorize token rotation, STAFF/member
> creation, profile or DIE data entry, BL activation, worker or ClamAV changes,
> direct Compose use, destructive rollback, or any additional migration or
> resource redeploy.
