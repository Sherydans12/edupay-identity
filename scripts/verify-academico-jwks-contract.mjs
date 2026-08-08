import { createRemoteJWKSet, jwtVerify } from 'jose';

const baseUrl = process.env.IDENTITY_BASE_URL;
const accessToken = process.env.IDENTITY_ACCESS_TOKEN;
const issuer = process.env.IDENTITY_EXPECTED_ISSUER;
const audience = process.env.IDENTITY_EXPECTED_AUDIENCE;

const missing = [
  ['IDENTITY_BASE_URL', baseUrl],
  ['IDENTITY_ACCESS_TOKEN', accessToken],
  ['IDENTITY_EXPECTED_ISSUER', issuer],
  ['IDENTITY_EXPECTED_AUDIENCE', audience],
].filter(([, value]) => !value);

if (missing.length > 0) {
  process.stderr.write(`Missing required environment variables: ${missing.map(([name]) => name).join(', ')}\n`);
  process.exitCode = 1;
} else {
  const jwksUrl = new URL('/.well-known/jwks.json', baseUrl);
  const { payload } = await jwtVerify(accessToken, createRemoteJWKSet(jwksUrl), {
    issuer,
    audience,
    requiredClaims: ['sub', 'sid', 'jti', 'iat', 'nbf', 'exp', 'scope', 'amr', 'auth_time'],
  });

  const hasTenant = payload.tenant_id !== undefined;
  if (
    hasTenant !== (payload.membership_id !== undefined) ||
    hasTenant !== Array.isArray(payload.roles) ||
    !Array.isArray(payload.scope) ||
    !Array.isArray(payload.amr)
  ) {
    throw new Error('Identity access token does not satisfy the approved claim-shape contract');
  }

  process.stdout.write(
    `${JSON.stringify({
      valid: true,
      subject: payload.sub,
      sessionId: payload.sid,
      tenantContext: hasTenant,
      expiresAt: payload.exp,
    })}\n`,
  );
}
