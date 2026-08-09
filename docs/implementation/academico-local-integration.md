# Académico local JWT/JWKS integration

Status: implementation and test path; the accepted API and JWT contracts remain authoritative

EduPay Académico validates Identity access tokens through the public JWKS endpoint. It never receives, reads, or stores the Identity private signing key.

## Local contract path

1. Start an Identity-owned PostgreSQL database, apply `pnpm prisma:migrate:deploy`, and run Identity with disposable keys created by `pnpm keys:generate:dev`.
2. Provision only synthetic local tenant, user, verified-email/username, credential, membership, and role records. Keep the test password outside source control.
3. Obtain an access token from `POST /api/v1/auth/login` with the synthetic credentials.
4. In the Académico test process, fetch `GET /.well-known/jwks.json` from the running Identity service and validate the access token's signature, issuer, audience, time bounds, and approved claim shape.
5. For a standalone smoke check, expose the token only as an ephemeral process environment value and run `pnpm contract:verify:jwks`. The command prints no token and reads no private key.

Required smoke-check variables are `IDENTITY_BASE_URL`, `IDENTITY_ACCESS_TOKEN`, `IDENTITY_EXPECTED_ISSUER`, and `IDENTITY_EXPECTED_AUDIENCE`.

The repository integration scenario in `test/authentication.integration-spec.ts` is the executable fixture for this path. It generates an ephemeral Identity-only private key, publishes only its public JWK, obtains a real login token through the API, and validates that token as an external JWKS consumer would. This is a real asymmetric-token contract test, not a fake authentication mode.

Académico must continue to apply its own academic resource policies after JWT validation. The Identity `roles` claim grants only tenant membership roles.

## Browser integration

Configure the local frontend origin explicitly in `IDENTITY_TRUSTED_WEB_ORIGINS`. For HTTP
local development only, set `IDENTITY_COOKIE_SECURE=false`; production and HTTPS deployments
must keep it `true`. Identity does not auto-allow localhost origins.

The frontend keeps the access token in memory and never uses localStorage, sessionStorage,
IndexedDB, or a JavaScript-readable persistent cookie. Login, refresh, logout, and logout-all
requests to Identity use `credentials: 'include'`. Identity stores the browser refresh token
in its own HttpOnly cookie, rotates it on refresh, and omits it from browser JSON. The frontend
must send the access token in `Authorization: Bearer` for authenticated API calls and must
not attempt to read or copy the refresh cookie.

## Restricted backend verification

Configure the same generated server-only value as `IDENTITY_ACADEMICO_SERVICE_TOKEN` in Identity
and the protected Académico backend adapter secret. Generate at least 32 random bytes and encode
them as base64url. Do not use an access JWT, browser cookie, `NEXT_PUBLIC` variable, committed env
file, or human-created password as this credential.

Académico calls:

- `GET /internal/v1/sessions/{sessionId}/status` before the explicitly high-risk operations that
  require fresh session/membership state;
- `POST /internal/v1/identity-users/resolve` with the already validated JWT actor identifiers, one
  exact target IdentityUser ID, and `STUDENT` or `TEACHER` before writing its academic link.

Every request sends `Authorization: Bearer <server-held-service-token>` and `X-Request-Id`, uses
HTTPS and/or a private trusted network, and remains backend-only. Identity independently revalidates
the human actor for link verification; the service credential alone grants no membership mutation.

Linking a target in `PENDING_ACTIVATION` is expected: Académico may save the Student/Teacher link,
then the user completes Identity activation and signs in normally. The pending state grants no
application access.

For rotation, deploy Identity with a new current token, the old value in
`IDENTITY_ACADEMICO_SERVICE_TOKEN_PREVIOUS`, and an ISO-8601
`IDENTITY_ACADEMICO_SERVICE_TOKEN_PREVIOUS_EXPIRES_AT` no more than 24 hours ahead. Update every
Académico instance, verify calls with the new value, then remove the previous value and expiry
before the deadline. Never place either value in logs or tickets.
