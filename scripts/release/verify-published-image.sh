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
attestation_file="$(mktemp)"
trap 'rm -f "$manifest_file" "$attestation_file"' EXIT

docker buildx imagetools inspect "$immutable_reference"
docker buildx imagetools inspect --raw "$immutable_reference" >"$manifest_file"

attestation_count="$(jq '[.manifests[]? | select(.annotations["vnd.docker.reference.type"] == "attestation-manifest")] | length' "$manifest_file")"
if (( attestation_count < 1 )); then
  printf 'Expected an OCI attestation manifest; found %s\n' "$attestation_count" >&2
  exit 1
fi

sbom_predicate=0
provenance_predicate=0
while IFS= read -r attestation_digest; do
  docker buildx imagetools inspect --raw "$IMAGE@$attestation_digest" >"$attestation_file"
  if jq -e '[.layers[]? | .annotations["in-toto.io/predicate-type"]? | select(type == "string" and startswith("https://spdx.dev/"))] | length > 0' "$attestation_file" >/dev/null; then
    sbom_predicate=1
  fi
  if jq -e '[.layers[]? | .annotations["in-toto.io/predicate-type"]? | select(type == "string" and startswith("https://slsa.dev/provenance/"))] | length > 0' "$attestation_file" >/dev/null; then
    provenance_predicate=1
  fi
done < <(jq -r '.manifests[]? | select(.annotations["vnd.docker.reference.type"] == "attestation-manifest") | .digest' "$manifest_file")

if (( sbom_predicate != 1 || provenance_predicate != 1 )); then
  printf 'Expected SPDX SBOM and SLSA provenance predicates in OCI attestations\n' >&2
  exit 1
fi

docker pull "$immutable_reference"

test "$(docker inspect "$immutable_reference" --format '{{index .Config.Labels "org.opencontainers.image.source"}}')" = "$SOURCE_URL"
test "$(docker inspect "$immutable_reference" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$SOURCE_SHA"
test "$(docker inspect "$immutable_reference" --format '{{json .Config.Cmd}}')" = "$EXPECTED_CMD_JSON"

printf 'IMMUTABLE_REFERENCE=%s\n' "$immutable_reference"
printf 'IMAGE_DIGEST=%s\n' "$IMAGE_DIGEST"
printf 'SOURCE_SHA=%s\n' "$SOURCE_SHA"
printf 'ATTESTATIONS=%s (SPDX SBOM + SLSA provenance mode=max)\n' "$attestation_count"
