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
