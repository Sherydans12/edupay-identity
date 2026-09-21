# Password-recovery email incident — 2026-09-17

## Scope and status

This incident concerns password-recovery requests originating in EduPay Académico. Identity remains the owner of credentials, recovery tokens, eligibility, and email delivery. No account, password, token, database, DNS, permission, or migration changes were made. The previously deployed Académico CORS hotfix was preserved; Académico 404s were not changed.

The production resource changed was Identity only:

- Coolify resource: `identity-0vrvqepcukwcubxga0narorf` (`edupay-identity-pinned`)
- Production base revision inspected before editing: `b38849be78fee492f68f2d0e99cff3b69a08415`
- Previous image: `ghcr.io/sherydans12/edupay-identity@sha256:eb35930f4fb0358d891c50c57e301d47fb033b9d9a0b53284fea0b68e73aa7f8`
- Hotfix commit: `1887128` (`fix(identity): continuously deliver recovery email outbox`)
- Diagnostic/concurrency commit: `b00714b` (`fix(identity): preserve safe email provider diagnostics`)
- Deployed image: `ghcr.io/sherydans12/edupay-identity@sha256:8d821fdb5b76c05ebb934ae0b554e721dea64089a07795adc133de3d94e974e6`
- Deployment result: container running and healthy; `identity-migrate` was not run and remains unchanged.

The image was built from the inspected production-compatible revision plus the isolated hotfix. The hotfix branch and the main integration branch contain no unrelated onboarding or Académico changes.

## Demonstrated cause

The Académico client calls Identity with `POST /api/v1/auth/password-recovery/request`, JSON `identifier` plus optional `tenantHandle`, and `X-Request-Id`. The controller intentionally returns `202 {"accepted":true}` without revealing account existence; it applies source/identifier rate limits and passes the request ID into the audit record. CORS allows the explicit Académico origin and the legitimate header set, including `Idempotency-Key`.

For an eligible account, Identity creates a one-time hashed reset token, encrypts the email intent in the durable outbox, and returns the generic response. Before this hotfix, the API container wrote the outbox intent but had no application bootstrap drain or periodic delivery loop, and no Identity email-worker container was running. Production evidence before deployment showed three password-recovery events still `PENDING`, with zero attempts, no provider response IDs, and no errors. Therefore those messages had never reached Resend.

The hotfix starts one bounded in-process drain at application startup, checks pending Identity email intents every five seconds, and schedules an immediate drain after an intent is committed. Shutdown clears the timer. It does not change eligibility, rate limiting, authorization, token hashing, expiration, one-time use, encryption, tenant isolation, or provider idempotency keys.

After deployment, the scheduler attempted the three pending events. All three became `FAILED` with the application-safe code `RESEND_PROVIDER_REJECTED` and no provider response IDs. A separate authenticated, non-sending diagnostic request to Resend's domains endpoint returned HTTP `400`, provider code `validation_error`, and sanitized message `API key is invalid`. This is a provider-side credential failure, not a network failure. A later real request at a separate UTC time also became `FAILED` once, bringing the aggregate to four failed recovery events; it was not requeued. No provider response body, key, recipient, recovery link, or token was recorded here. No provider credential was changed.

The encrypted outbox structure was inspected without printing values: all three original events contained exactly `to`, `from`, `subject`, `text`, and `html`; the sender domain was `edupay.baselogic.cl`; the recovery URL domain/path were `academico.edupay.baselogic.cl/reset-password`; and each delivery key matched the `password-reset:<uuid>` shape. The payload contract and recovery URL are therefore not the cause. The exact blocker is the invalid Resend API key. Resend account/domain verification remains a separate prerequisite to confirm after the key is corrected.

The adapter now retains only an allowlisted provider code and a bounded message with emails, URLs, opaque values, and secret-like values redacted. Historical rows keep their safe error only; no private provider response was backfilled.

Required external intervention was limited to the Resend console: the user replaced only the Coolify Identity secret `RESEND_API_KEY` with an active sending key. No DNS, sender-domain, account, or permission change was made by this work. The user then confirmed that one new recovery request arrived successfully. The four terminally failed historical intents were not manually requeued or resent.

## Sanitized verification

Before and after deployment, the public checks used only synthetic `.invalid` identifiers or health/preflight requests:

- Académico origin + `POST` + `content-type,x-request-id,idempotency-key`: `OPTIONS` returned `204`, exact `Access-Control-Allow-Origin`, explicit methods/headers, `Access-Control-Expose-Headers: X-Request-Id`, and `Vary: Origin`.
- Unauthorized origin: `OPTIONS` returned `404` with no CORS permission header.
- Synthetic non-eligible POST: `202`, generic `{"accepted":true}`, exact Académico CORS, and the supplied safe `X-Request-Id` echoed.
- Identity health: HTTP `200`; deployed container: `running (healthy)`; command remains `node dist/main.js`.
- Outbox after the diagnostic redeploy: six historical recovery events remain `PUBLISHED` with provider IDs; four recovery events are terminal `FAILED`, each at `attempts=1`, with `RESEND_PROVIDER_REJECTED` and zero provider IDs. After waiting beyond one scheduler interval, the aggregate was unchanged. No agent-generated real recipient was used.
- User confirmation: after the key replacement, the user submitted one new recovery request and confirmed receipt. This confirms the provider-to-mailbox outcome for that request by user report; it does not verify the complete password-change flow.

The isolated test suite passed: outbox/provider/application tests (8 tests), lint, typecheck, production build, and the account-lifecycle integration suite (8 tests) against a disposable PostgreSQL container. The tests cover provider diagnostic redaction, permanent rejection without retry, concurrent drain serialization, synthetic teacher eligibility, generic unknown-account behavior, outbox creation, fake delivery, expiration, one-time consumption, and session revocation. No production migration was executed.

## Rollback

Before the first production edit, the exact Identity container and Compose configuration were captured at `/root/edupay-identity-recovery-20260917-pre` with restricted permissions. A first pull attempt used the unpublished registry reference and failed before changing the running service; Compose was restored to the previous digest and Coolify successfully recreated the original healthy container. The first published scheduler image and then the diagnostic image were deployed; the final resource is healthy. No data rollback was needed.

Rollback procedure: restore the saved Compose image reference to the previous digest, save the Identity resource, and use Coolify “Pull latest and restart”; verify the container digest, health, and public health endpoint. Do not start `identity-migrate` as part of rollback.

## Separate 404 observations

`/favicon.ico` remains a cosmetic frontend 404. The subject route ending in `/estudiantes?_rsc=…` remains a separate Académico/Next route or prefetch investigation and was intentionally not changed during this incident. Neither was used as the cause of password-recovery delivery failure.

## User confirmation

The prior unit-creation incident is confirmed resolved by the user. The password-recovery delivery incident is resolved by user confirmation: after replacing `RESEND_API_KEY`, one new recovery email arrived. The complete password-change flow remains unverified and is intentionally not claimed as tested. No historical `FAILED` outbox event was requeued or resent.

## Recovery-email template follow-up

The subsequent template improvement is intentionally limited to `createPasswordRecoveryEmail`. It keeps the existing token, authorized account UI URL, configured expiration, outbox idempotency, generic API response, and security controls. The existing invitation template remains a separate English template and was inventoried but not changed in this cut.

## Spanish recovery-email deployment — 2026-09-21

- PR #9 was verified with head `a5b6f54d114b07b4428fcf00f2a8d95bf2418e00`, CI `validate` passed, and it was merged into `main` as `fd4a8767e5f9f6f5cb39c76020864027f0458a00`.
- The only published runtime artifact was `ghcr.io/sherydans12/edupay-identity@sha256:6733d04b53c87145429927b2d9a37e2fe7d44d73314d857c6a03bd8e67f64103`, built from the merged template source and tagged with both source and merge SHAs.
- Only Coolify resource `identity-0vrvqepcukwcubxga0narorf` was recreated. The existing `RESEND_API_KEY` environment entry was preserved and was not printed or replaced. Invitation code and the migration image were not changed.
- Rollback was captured before deployment at `/root/edupay-identity-template-20260921-pre2`, including the previous image reference `sha256:8d821fdb5b76c05ebb934ae0b554e721dea64089a07795adc133de3d94e974e6`, Compose configuration, runtime command, and environment-name inventory. Rollback requires restoring that image reference and Compose state, recreating only Identity, and verifying health; do not start `identity-migrate`.
- The first direct Compose recreation omitted the existing private `coolify` network attachment, producing one synthetic POST `500` with a database DNS `EAI_AGAIN`. No real request, email, token, payload, or database write was involved. The Identity service was then reconfigured with its existing resource network plus `coolify`; `SELECT 1` from the container passed and the synthetic POST returned `202`.
- Persistence follow-up after deployment: Coolify resource `0vrvqepcukwcubxga0narorf` was checked read-only in Coolify and in its database; `services.connect_to_docker_network` is `true`. After a page reload, the resource still showed `Connect to the predefined Coolify network`. Coolify 4.3.14's installed `StartService` and `DeployServiceApplication` actions were also inspected read-only: when this flag is true, their deployment commands connect each service container to the destination network after `docker compose up`. This is the persistent safeguard; a manual `docker network connect` is not the configuration of record.
- The generated Compose preview still shows the stack network only. That preview was not treated as proof of private-network attachment because the Coolify deployment actions apply the persisted flag after Compose startup. Separately, the live Identity container was observed on both `0vrvqepcukwcubxga0narorf` and `coolify`, and the prior in-container `SELECT 1` check passed. No Identity recreation, restart, deployment, migration, image, environment, or invitation change was performed during this persistence check while Onboarding was deploying. A future recreation was not deliberately exercised; the persistence setting and the existing runtime are verified independently.
- Reconciliation after Onboarding — 2026-09-21: before editing, the recoverable snapshot `/root/edupay-identity-coolify-config-20260921-pre` was captured with mode `600`; its raw persisted Compose hash was `3c636e3eed4465933e76392917e6fcf049c41c3eaaec0d7a413441d990ffa109` and its manifest hash was `d416b024501860f255110a39eec6cfe67d313a88700f407f93578b56f11ff7b8`. The saved Compose referenced the previous image `sha256:8d821fdb...`, while the active container already used `sha256:6733d04b...`; the persisted network flag was already `true`.
- Using Coolify's supported Compose editor, only the Identity image reference was changed to `sha256:6733d04b53c87145429927b2d9a37e2fe7d44d73314d857c6a03bd8e67f64103`. Coolify validation succeeded. `Save changes` persisted the configuration without Pull, Deploy, restart, container recreation, migration, secret, outbox, or invitation changes. After reload, the UI showed the active digest and `Connect to the predefined Coolify network`; the persisted Compose hash became `8a84c462030d78aacd0efb4a3ac5e6909bc4e24eece535ffcd0dbdb118fd6c16`.
- The final generated preview uses the active digest and stack network only; Coolify's verified post-`up` network hook will attach `coolify` on the next Coolify-managed deployment because `connect_to_docker_network=true`. The live container remained `running/healthy` on the active digest and both networks, with public health `200`. The UI reports `Configuration changes not applied`, correctly distinguishing saved future-deployment configuration from the intentionally untested recreation. The demonstrated loss cause was the prior direct Compose recreation bypassing that Coolify hook; direct Compose remains an unsupported deployment path for this resource.
- Final public verification: Identity health `200`, JWKS `200`, authorized Académico preflight `204` with exact origin and `Idempotency-Key`, unauthorized preflight `404` without CORS permission, and synthetic recovery POST `202 {"accepted":true}` with the safe request ID echoed. The runtime reports `healthy` at the new digest and no migration runner is active.
- Final sanitized outbox state: seven password-recovery events are `PUBLISHED`; four historical password-recovery events remain `FAILED` with `attemptCount=1`. No historical event was requeued or resent. No scheduler/outbox/Resend error lines were observed in the five-minute post-deployment log window.
- User confirmation remains pending for this deployment: the user must submit exactly one new recovery request from the normal session to inspect Spanish language, presentation, and the authorized link. Receipt and presentation will not be treated as proof that the complete password-change flow was tested.
