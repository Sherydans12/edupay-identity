# EduPay Identity architecture decision records

Status: accepted decisions; authoritative within the documented scope
Accepted: 2026-08-08

These ADRs turn the Identity architecture into explicit contracts. All nine records below have explicit owner approval and are authoritative for implementation. Operational tunables and unrelated follow-up decisions remain in the architecture document’s remaining-unresolved section.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](ADR-0001-identity-ownership-boundary.md) | Independent Identity ownership boundary | Accepted (2026-08-08) |
| [0002](ADR-0002-membership-context-and-tenant-claims.md) | Membership-derived active tenant context | Accepted (2026-08-08) |
| [0003](ADR-0003-login-identifiers-and-uniqueness.md) | Separate username/email identifiers | Accepted (2026-08-08) |
| [0004](ADR-0004-no-email-activation.md) | One-time no-email activation challenge | Accepted (2026-08-08) |
| [0005](ADR-0005-session-and-token-strategy.md) | Short JWT plus rotated opaque refresh token | Accepted (2026-08-08) |
| [0006](ADR-0006-academic-linking-boundary.md) | Optional academic links owned by Académico | Accepted (2026-08-08) |
| [0007](ADR-0007-identity-api-and-events.md) | Versioned API, JWKS, and durable events | Accepted (2026-08-08) |
| [0008](ADR-0008-existing-admin-coexistence.md) | Leave existing EduPay admin auth untouched | Accepted (2026-08-08) |
| [0009](ADR-0009-browser-session-topology.md) | Browser-safe refresh-cookie and origin topology | Accepted (2026-08-09) |
