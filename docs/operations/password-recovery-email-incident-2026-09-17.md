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

Required external intervention: in the Resend console, create/identify an active API key with sending access, then update only the Coolify Identity secret `RESEND_API_KEY` with that exact value and redeploy Identity. Do not change DNS or use an unverified sender; confirm the existing `edupay.baselogic.cl` sender domain is verified before sending. This change has not been made. A new single recovery request should be made only after that intervention; the four terminally failed historical intents were not manually requeued.

## Sanitized verification

Before and after deployment, the public checks used only synthetic `.invalid` identifiers or health/preflight requests:

- Académico origin + `POST` + `content-type,x-request-id,idempotency-key`: `OPTIONS` returned `204`, exact `Access-Control-Allow-Origin`, explicit methods/headers, `Access-Control-Expose-Headers: X-Request-Id`, and `Vary: Origin`.
- Unauthorized origin: `OPTIONS` returned `404` with no CORS permission header.
- Synthetic non-eligible POST: `202`, generic `{"accepted":true}`, exact Académico CORS, and the supplied safe `X-Request-Id` echoed.
- Identity health: HTTP `200`; deployed container: `running (healthy)`; command remains `node dist/main.js`.
- Outbox after the diagnostic redeploy: six historical recovery events remain `PUBLISHED` with provider IDs; four recovery events are terminal `FAILED`, each at `attempts=1`, with `RESEND_PROVIDER_REJECTED` and zero provider IDs. After waiting beyond one scheduler interval, the aggregate was unchanged. No agent-generated real recipient was used.

The isolated test suite passed: outbox/provider/application tests (8 tests), lint, typecheck, production build, and the account-lifecycle integration suite (8 tests) against a disposable PostgreSQL container. The tests cover provider diagnostic redaction, permanent rejection without retry, concurrent drain serialization, synthetic teacher eligibility, generic unknown-account behavior, outbox creation, fake delivery, expiration, one-time consumption, and session revocation. No production migration was executed.

## Rollback

Before the first production edit, the exact Identity container and Compose configuration were captured at `/root/edupay-identity-recovery-20260917-pre` with restricted permissions. A first pull attempt used the unpublished registry reference and failed before changing the running service; Compose was restored to the previous digest and Coolify successfully recreated the original healthy container. The first published scheduler image and then the diagnostic image were deployed; the final resource is healthy. No data rollback was needed.

Rollback procedure: restore the saved Compose image reference to the previous digest, save the Identity resource, and use Coolify “Pull latest and restart”; verify the container digest, health, and public health endpoint. Do not start `identity-migrate` as part of rollback.

## Separate 404 observations

`/favicon.ico` remains a cosmetic frontend 404. The subject route ending in `/estudiantes?_rsc=…` remains a separate Académico/Next route or prefetch investigation and was intentionally not changed during this incident. Neither was used as the cause of password-recovery delivery failure.

## User confirmation

The prior unit-creation incident is confirmed resolved by the user. For this incident, the browser is prepared on Académico's recovery form, but real receipt is not yet confirmed. After the Resend credential/access intervention, the user must submit exactly one request from the existing teacher session and report the approximate local time and whether the message appears in inbox or spam. An API `202` or provider acceptance alone must not be treated as proof of receipt.
