# ADR-0003: separate username and email identifiers

Status: Proposed
Date: 2026-08-08

## Context

Students may have no email address. Institutional usernames and email addresses represent different identifiers and have different lifecycle and privacy rules.

## Proposal

Represent username and email as distinct identifier records. Normalize them independently. Usernames are unique within a tenant realm; a verified email maps to one Identity user globally by default. Login requires a tenant handle when a username or email is ambiguous across memberships. Unverified email matches do not auto-link accounts.

## Consequences

- Username-only students can authenticate.
- A user can use one Identity account across multiple tenant memberships.
- Import/link flows need explicit duplicate and conflict handling.

## Acceptance evidence

- Collision tests for Unicode/normalization, repeated usernames across tenants, duplicate verified emails, and ambiguous login.
- Generic errors that do not reveal account existence.

