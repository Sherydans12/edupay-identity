# ADR-0003: separate username and email identifiers

Status: Accepted
Date: 2026-08-08
Accepted: 2026-08-08
Decision authority: Identity architecture owner approval dated 2026-08-08

## Context

Students may have no email address. Institutional usernames and email addresses represent different identifiers and have different lifecycle and privacy rules.

## Decision

Represent username and email as distinct identifier records. Normalize them independently. Institutional usernames are unique within a tenant realm after safe normalization. Email is optional, and one verified email maps to one global IdentityUser. Login requires a tenant handle when a username or email is ambiguous across memberships. Unverified duplicate email values never cause automatic linking.

## Consequences

- Username-only students can authenticate.
- A user can use one Identity account across multiple tenant memberships.
- Import/link flows need explicit duplicate and conflict handling.

## Acceptance evidence

- Collision tests for Unicode/normalization, repeated usernames across tenants, duplicate verified emails, and ambiguous login.
- Generic errors that do not reveal account existence.
