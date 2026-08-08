# ADR-0004: one-time no-email activation challenge

Status: Proposed; required by product constraint
Date: 2026-08-08

## Context

Some students cannot receive email. An administrator must be able to hand activation information to the student, but must not create or know a permanent password.

## Proposal

Identity generates a random, one-time, expiring activation challenge bound to a pending membership. It stores only a hash and returns the plaintext challenge once to an authorized administrator under step-up/recent-authentication controls. The student uses it with their institutional username to establish a password. Regeneration revokes prior unused challenges.

## Consequences

- Offline/institutional handoff is possible without email.
- The handoff secret requires careful display, audit redaction, rate limiting, and expiration.
- No-email password recovery is an administrator-mediated reactivation challenge, not an administrator-set password.

## Acceptance evidence

- One-time use, expiry, guessing, concurrency, and regeneration tests.
- Review confirms the plaintext challenge is absent from logs, database, audit records, and analytics.

