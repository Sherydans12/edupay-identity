#!/usr/bin/env bash
set -euo pipefail

: "${IMAGE:?IMAGE is required}"
: "${IMAGE_DIGEST:?IMAGE_DIGEST is required}"
: "${SOURCE_SHA:?SOURCE_SHA is required}"
: "${SOURCE_URL:?SOURCE_URL is required}"
: "${EXPECTED_CMD_JSON:?EXPECTED_CMD_JSON is required}"

if [[ ! "$IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  printf 'Invalid OCI image digest: %s\n' "$IMAGE_DIGEST" >&2
  exit 1
fi

immutable_reference="$IMAGE@$IMAGE_DIGEST"
manifest_file="$(mktemp)"
trap 'rm -f "$manifest_file"' EXIT

docker buildx imagetools inspect "$immutable_reference"
docker buildx imagetools inspect --raw "$immutable_reference" >"$manifest_file"

attestation_count="$(jq '[.manifests[] | select(.annotations["vnd.docker.reference.type"] == "attestation-manifest")] | length' "$manifest_file")"
if (( attestation_count < 2 )); then
  printf 'Expected separate SBOM and provenance attestations; found %s\n' "$attestation_count" >&2
  exit 1
fi

docker pull "$immutable_reference"

test "$(docker inspect "$immutable_reference" --format '{{index .Config.Labels "org.opencontainers.image.source"}}')" = "$SOURCE_URL"
test "$(docker inspect "$immutable_reference" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$SOURCE_SHA"
test "$(docker inspect "$immutable_reference" --format '{{json .Config.Cmd}}')" = "$EXPECTED_CMD_JSON"

printf 'IMMUTABLE_REFERENCE=%s\n' "$immutable_reference"
printf 'IMAGE_DIGEST=%s\n' "$IMAGE_DIGEST"
printf 'SOURCE_SHA=%s\n' "$SOURCE_SHA"
printf 'ATTESTATIONS=%s (SBOM + BuildKit provenance mode=max)\n' "$attestation_count"
