#!/usr/bin/env bash
set -euo pipefail

: "${IMAGE:?IMAGE is required}"
: "${IMAGE_DIGEST:?IMAGE_DIGEST is required}"

if [[ ! "$IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  printf 'Invalid OCI image digest: %s\n' "$IMAGE_DIGEST" >&2
  exit 1
fi

immutable_reference="$IMAGE@$IMAGE_DIGEST"
container_name="identity-runtime-smoke-${RANDOM}-${RANDOM}"
host_port="${RUNTIME_SMOKE_PORT:-18080}"
key_directory="$(mktemp -d)"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  rm -rf "$key_directory"
}
trap cleanup EXIT

node --input-type=module - "$key_directory" <<'NODE'
import { generateKeyPairSync } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const directory = process.argv[2];
mkdirSync(directory, { recursive: true });
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
writeFileSync(join(directory, 'private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o644 });
writeFileSync(
  join(directory, 'public.jwks.json'),
  `${JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'runtime-smoke-key', alg: 'RS256', use: 'sig' }] })}\n`,
  { mode: 0o644 },
);
chmodSync(join(directory, 'private.pem'), 0o644);
NODE

docker run --detach --name "$container_name" --publish "$host_port:3000" \
  --volume "$key_directory:/run/identity-keys:ro" \
  --env NODE_ENV=test \
  --env PORT=3000 \
  --env DATABASE_URL=postgresql://identity:identity@127.0.0.1:5432/identity_ci \
  --env JWT_ISSUER=https://identity.ci.invalid \
  --env JWT_AUDIENCE=edupay-academico-api \
  --env JWT_ACCESS_TTL_SECONDS=600 \
  --env JWT_ALGORITHM=RS256 \
  --env JWT_KEY_ID=runtime-smoke-key \
  --env JWT_PRIVATE_KEY_PATH=/run/identity-keys/private.pem \
  --env JWT_PUBLIC_JWKS_PATH=/run/identity-keys/public.jwks.json \
  --env JWKS_CACHE_MAX_AGE_SECONDS=300 \
  --env ARGON2_MEMORY_COST=8192 \
  --env ARGON2_TIME_COST=2 \
  --env ARGON2_PARALLELISM=1 \
  --env ARGON2_HASH_LENGTH=32 \
  --env ARGON2_SALT_LENGTH=16 \
  --env OPAQUE_TOKEN_BYTES=32 \
  "$immutable_reference" >/dev/null

for attempt in {1..30}; do
  if curl --fail --silent "http://127.0.0.1:$host_port/api/v1/identity/health" >/tmp/identity-runtime-health.json; then
    break
  fi
  if [[ "$attempt" == 30 ]]; then
    docker logs "$container_name"
    exit 1
  fi
  sleep 1
done

jq -e '.status == "ok" and .service == "edupay-identity"' /tmp/identity-runtime-health.json >/dev/null
curl --fail --silent "http://127.0.0.1:$host_port/.well-known/jwks.json" >/tmp/identity-runtime-jwks.json
jq -e '.keys | length > 0 and all(.[]; has("d") | not)' /tmp/identity-runtime-jwks.json >/dev/null

for attempt in {1..30}; do
  health_status="$(docker inspect "$container_name" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}')"
  if [[ "$health_status" == healthy ]]; then
    break
  fi
  if [[ "$attempt" == 30 ]]; then
    docker logs "$container_name"
    printf 'Container health status: %s\n' "$health_status" >&2
    exit 1
  fi
  sleep 1
done

printf 'RUNTIME_HEALTH=PASS\n'
printf 'RUNTIME_JWKS=PASS\n'
printf 'RUNTIME_CONTAINER_HEALTH=PASS\n'
