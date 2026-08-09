# ADR-0009: browser-safe session topology

Status: Accepted
Date: 2026-08-09
Accepted: 2026-08-09
Decision authority: Identity browser-session owner approval

## Context

EduPay Académico needs a browser session boundary without exposing Identity refresh
credentials to frontend JavaScript. The existing Identity session core already owns
opaque refresh-token rotation, family reuse detection, session expiry, and revocation.
The browser transport must preserve those invariants while remaining compatible with
explicit non-browser API clients.

## Decision

Identity uses two unambiguous session transports:

1. A request with an `Origin` header is browser mode. The origin must exactly match an
   explicitly configured `IDENTITY_TRUSTED_WEB_ORIGINS` entry. Browser login and refresh
   set or consume an Identity-owned refresh cookie; browser JSON never contains the
   plaintext refresh token.
2. A request without an `Origin` and without the Identity refresh cookie is the
   non-browser transport. It keeps the existing JSON refresh-token contract for API
   clients. The transport is never selected for a request that presents a browser
   origin or cookie; no custom JavaScript-readable CSRF secret or weaker header switch
   is used.

The production browser cookie is `__Host-edupay-refresh` and has:

- `HttpOnly` and `Secure`;
- `SameSite=Lax` by default, with `SameSite=None` allowed only through explicit secure
  deployment configuration when the trusted frontend is cross-site;
- `Path=/` and no `Domain` attribute, making it host-only;
- an expiry no later than the rotated refresh token/session idle or absolute expiry.

When HTTP local development is explicitly enabled with `IDENTITY_COOKIE_SECURE=false`,
Identity uses a host-only development cookie name without the `__Host-` prefix because
browsers reject that prefix without `Secure`. Production rejects insecure cookie mode.

Browser refresh, logout, and logout-all require a trusted `Origin`. Missing or unknown
origins are rejected whenever a cookie is presented or browser mode is selected.
SameSite protection and Fetch Metadata are defense in depth; the origin allowlist is
the authoritative cross-origin check. CORS reflects only an allowlisted exact origin,
enables credentials only for that origin, and never uses `*` with credentials.

## API behavior

- Browser login authenticates, creates the normal session, sets the refresh cookie, and
  returns only the access token, expiry, session ID, and active membership context.
- Browser refresh reads the cookie, performs the existing atomic rotation, sets the
  replacement cookie, and returns only the new access-token response.
- Refresh reuse or invalid-session errors preserve existing safe error codes and clear
  the browser cookie after revocation/invalidity is detected.
- Browser logout and logout-all revoke the applicable session state and clear the
  current browser refresh cookie. Logout remains retry-safe.
- Access tokens remain frontend-memory-only. Identity does not recommend or support
  localStorage, sessionStorage, IndexedDB, or persistent JavaScript-readable cookies
  for access or refresh tokens.

## Consequences

- XSS cannot directly read the browser refresh credential, although frontend XSS still
  requires the normal application-content-security response.
- CORS is not treated as CSRF protection. Cookie-authenticated session operations have
  an independent trusted-origin boundary.
- Cross-site frontend deployments must explicitly select `SameSite=None` and retain
  HTTPS; same-site EduPay deployments can use the safer `Lax` default.
- Non-browser API clients must keep refresh tokens in their own protected credential
  store and must not send browser cookies.

## Acceptance evidence

- Browser integration tests assert cookie attributes, token omission, rotation, reuse
  revocation, missing/malformed-cookie handling, hostile-origin rejection, logout
  clearing, and audit/error redaction.
- Bootstrap tests assert exact credentialed CORS allowlisting and no wildcard origin.
- Environment tests assert explicit origin parsing and fail-closed production cookie
  configuration.
