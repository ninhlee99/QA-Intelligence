# Permissions

## Roles

| Role | Can | Cannot |
|------|-----|--------|
| admin | | |
| user | | |
| guest | | |

## Authz risks (tag: permission)

- <!-- control visible but action not blocked -->
- <!-- API allows role escalation -->

## Test expectation

When ≥2 roles matter, QA Intelligence MUST run role UI compare + API authz negatives when OpenAPI exists.
