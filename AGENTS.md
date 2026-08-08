# EduPay Identity agent governance

## Authority and scope

- Accepted ADRs and accepted architecture, API, security, and testing documents are authoritative.
- Identity owns authentication, memberships, sessions, credentials, login identifiers, invitations, activation/reset flows, and authentication/security audit evidence.
- Identity does not own academic domain entities such as students, teachers, courses, subjects, assignments, submissions, payments, debts, grades, or attendance.
- Keep Identity and consumer applications as independent services and databases. No direct database access, shared tables, or cross-service foreign keys are permitted.
- Do not redesign, migrate, federate, share cookies with, or otherwise alter existing EduPay administrative authentication.
- Email is optional. Username and email are separate login identifiers with separate normalization and verification rules.
- Do not expand scope into academic functionality or implement academic resource policies in Identity.

## Security invariants

- Never create administrator-known permanent passwords.
- Activation, reset, invitation, and refresh secrets are opaque, one-time or rotated as applicable, hashed at rest, and never logged.
- Never commit plaintext secrets, credentials, tokens, certificates, or configuration containing secrets.
- Never commit JWT private signing keys. Use managed secret/key custody and publish only approved public JWKS material.
- Tenant context comes only from trusted Identity state: validated token claims or an approved current-membership/session check.
- Client-provided tenant values are selectors at most; they cannot grant authorization.
- The canonical ecosystem tenant identifier is exchanged through authenticated contracts. Identity's `TenantRealm` and Académico's tenant record use the same stable logical identifier while retaining independent persistence.
- Identity grants tenant membership roles only. Académico decides subject, roster, learning-content, assignment, and submission access.
- `SYSTEM_ADMIN` does not automatically become a tenant member. Tenant support requires explicit elevated context, reason, and audit. User impersonation is out of scope for MVP.

## Change and delivery rules

- Do not implement directly on `main` during parallel work. Use an isolated branch or worktree and keep the change focused.
- API, JWT/JWKS, event, ownership, tenant-context, or other security-contract changes require ADR review and updates to affected contracts/tests.
- Tests are mandatory for security-sensitive behavior, especially tenant isolation, identifier collisions, token validation, refresh reuse, revocation, activation/reset secrecy, linking, and support elevation.
- Preserve the independent-service/database boundary and use authenticated APIs/events for integration.
- Do not use destructive Git operations, rewrite shared history, or force-push.
