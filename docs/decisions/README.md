# EduPay Identity ADR proposals

Status: proposed decisions awaiting owner review

These ADRs turn the Identity architecture into explicit reviewable contracts. “Proposed” is not an implementation approval until the owner, reviewers, and acceptance date are recorded.

| ADR | Proposal | Status |
| --- | --- | --- |
| [0001](ADR-0001-identity-ownership-boundary.md) | Independent Identity ownership boundary | Proposed / mandated boundary |
| [0002](ADR-0002-membership-context-and-tenant-claims.md) | Membership-derived active tenant context | Proposed / mandatory security property |
| [0003](ADR-0003-login-identifiers-and-uniqueness.md) | Separate username/email identifiers | Proposed |
| [0004](ADR-0004-no-email-activation.md) | One-time no-email activation challenge | Proposed / required workflow |
| [0005](ADR-0005-session-and-token-strategy.md) | Short JWT plus rotated opaque refresh token | Proposed |
| [0006](ADR-0006-academic-linking-boundary.md) | Optional academic links owned by Académico | Proposed / mandated boundary |
| [0007](ADR-0007-identity-api-and-events.md) | Versioned API, JWKS, and durable events | Proposed |
| [0008](ADR-0008-existing-admin-coexistence.md) | Leave existing EduPay admin auth untouched | Proposed / mandated initial constraint |

