# ADR-0002: membership-derived active tenant context

Status: Proposed; tenant isolation is mandatory
Date: 2026-08-08

## Context

Users may belong to multiple tenants. A client-provided tenant ID is mutable and cannot be trusted for authorization.

## Proposal

Identity verifies the user’s membership and issues an access token containing the selected `tenant_id`, `membership_id`, and effective roles. A membership-switch endpoint issues a new context token after verifying ownership and active status. No active tenant context means no tenant-scoped authorization, including for `SYSTEM_ADMIN`.

Académico validates the token and applies resource authorization. High-risk actions may perform an online Identity session/membership check.

## Consequences

- Context switching is explicit and auditable.
- Access-token staleness is bounded by its short expiry.
- System-admin support requires a separate elevated path rather than silent tenant inheritance.

## Acceptance evidence

- Two-tenant fixtures and cross-tenant negative tests.
- Membership switch cannot select another user’s membership.
- Role/membership revocation tests show the approved staleness ceiling.

