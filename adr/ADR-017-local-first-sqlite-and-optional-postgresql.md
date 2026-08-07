---
id: ADR-017
title: Local-First SQLite Runtime and Optional PostgreSQL Collaboration
status: accepted
version: 1.1.0
date: 2026-08-05
decision_owners:
  - Repository Owner
  - Architecture
  - Runtime Platform
  - Security
related_specs:
  - SPEC-103
  - SPEC-309
  - SPEC-310
  - SPEC-501
  - SPEC-601
  - SPEC-606
  - SPEC-607
related_adrs:
  - ADR-008
  - ADR-011
  - ADR-013
  - ADR-014
  - ADR-016
supersedes:
  - ADR-012
superseded_by: null
approved_by:
  - Repository Owner through explicit local-process and SQLite confirmation
  - Codex Architecture and Change-Impact Review
approval_evidence: governance/reviews/local-first-persistence/CHANGE_IMPACT.yaml
---

# ADR-017: Local-First SQLite Runtime and Optional PostgreSQL Collaboration

## 1. Context

QA Intelligence is primarily consumed from Codex, Claude Code, Cursor, and
other local hosts through MCP. Its parent Agent must manage QA workflows,
sub-agents, test workers, checkpoints, evidence, and recovery on the user's
machine by default. Requiring a PostgreSQL server for an individual user would
add deployment, identity, backup, networking, and failure surfaces that are not
needed for a local Workspace.

ADR-012 assumed a centralized service before the local MCP distribution model
was confirmed. This decision corrects that assumption without weakening
durability, auditability, Workspace isolation, or the optional shared-service
path.

## 2. Decision

QA Intelligence SHALL be local-first.

The default personal profile uses:

- one OS-user-owned QA Intelligence parent runtime on the user's machine
- a local MCP `stdio` bridge or local socket bridge used by host packages
- one SQLite database file per Workspace
- SQLite WAL mode, foreign keys, busy timeout, explicit transactions,
  optimistic revisions, command idempotency, and a local transactional outbox
- local evidence storage beside the Workspace state, with integrity metadata in
  SQLite and sensitive data governed by retention policy
- bounded local worker processes or sandboxes coordinated by the parent runtime

The default layout is conceptually:

```text
user state root/
  workspaces/
    <workspace-id>/
      qa-intelligence.sqlite
      evidence/
      logs/
```

The concrete state root is selected through an explicit configuration seam and
defaults to the operating system's per-user application-data location. A
Workspace identifier SHALL be validated before it becomes a filesystem path.

## 3. Local Process Ownership

The parent runtime owns lifecycle authority. Sub-agents and test workers SHALL
NOT open the SQLite database directly or advance authoritative state. They
receive bounded work from the parent and return observations through governed
runtime interfaces.

Only one local parent runtime may hold the active owner lease for a Workspace.
Multiple hosts MAY connect to the same local runtime through a local socket
bridge. A direct `stdio` process is permitted for a single-host profile only
when it acquires the same exclusive Workspace owner lease. SQLite locking is a
last line of consistency defense, not a replacement for runtime ownership.

Worker loss, host restart, or MCP disconnection does not transfer authority to
a child process. The next parent reconstructs state from SQLite, verifies
pinned versions, policies, leases, cleanup, and unknown effects, then resumes
only safe work.

## 4. Workspace and User Isolation

- Each Workspace uses a separate database and evidence directory by default.
- Local state directories are accessible only to the owning OS user.
- Database rows still retain immutable Workspace identity to detect wrong-file
  or import mistakes.
- Credentials are never stored as ordinary campaign or evidence payloads.
- SQLite files rely on OS account isolation, restrictive permissions, and
  approved disk encryption; stronger application-level encryption requires a
  separately conformant storage adapter.
- Export, import, backup, restore, and deletion are explicit user operations and
  preserve or verify Workspace identity and integrity.

Multiple OS users on one machine receive independent state roots. No local
database is silently shared or synchronized between users.

## 5. Shared and Team Profile

PostgreSQL remains an optional adapter when a Workspace must be shared across
users or machines, execute distributed workers, integrate centralized CI, or
retain enterprise audit state. The shared profile uses authenticated remote MCP,
server-side authorization, database isolation controls, and the ADR-012
transactional-outbox structures as an adapter-specific baseline.

Switching a Workspace from local SQLite to shared PostgreSQL is an explicit
governed migration. It requires integrity verification, stable identity and
revision preservation, conflict policy, rollback evidence, and user approval.
It SHALL NOT occur automatically as an incidental synchronization feature.

## 6. Module and Adapter Rules

Domain modules consume provider-neutral repository and runtime interfaces.
SQLite and PostgreSQL are adapters at the same persistence seam. Neither SQL
dialect, driver object, path, table, row, transaction handle, nor server topology
may leak into Agent, Skill, Rule, Knowledge, Evaluation, or MCP semantics.

The local and shared adapters SHALL pass the same lifecycle, idempotency,
optimistic-concurrency, retention, corruption, and Workspace identity contract
suite. Adapter-specific tests additionally prove SQLite process/file behavior or
PostgreSQL distributed/RLS behavior.

## 7. Consequences

- An individual user can install and use QA Intelligence without operating a
  database server.
- Process state, test history, and evidence remain on the user's machine by
  default.
- One database per Workspace makes backup, deletion, and isolation easier to
  explain and verify.
- SQLite's single-writer model fits parent-owned local orchestration but does not
  justify uncontrolled multi-process writers.
- Shared multi-user operation remains available without making its complexity a
  requirement for every user.
- Local device loss, disk exhaustion, corruption, and backup become explicit
  operational risks and require user-visible health and recovery behavior.

## 8. Alternatives Considered

- **PostgreSQL required for every user** was rejected because it conflicts with
  local MCP use and makes personal process management depend on a server.
- **One SQLite file shared by every Workspace** was rejected because it enlarges
  isolation, backup, and deletion blast radius.
- **One independent runtime per host application** was rejected because Codex,
  Claude Code, and Cursor could race to own the same work and database.
- **Child agents writing SQLite directly** was rejected because it breaks parent
  authority, optimistic lifecycle control, and recovery attribution.
- **Automatic local-to-cloud synchronization** was rejected because conflict,
  authority, privacy, and deletion semantics require an explicit product design.
- **`better-sqlite3` (native binding) instead of Node's built-in `node:sqlite`**
  was rejected. `node:sqlite` (`DatabaseSync`) is API-equivalent to
  `better-sqlite3` — Node's implementation is derived from the same
  synchronous design — so switching would not add capability. It would add a
  native compiled dependency requiring prebuilt binaries per OS/architecture,
  which ADR-011 §5 treats as a decision requiring architecture review because
  it reduces portability and reproducibility, and it would break the
  two-dependency (`ajv`, `ajv-formats`) surface the runtime baseline
  currently holds. `node:sqlite` remains labeled experimental by Node (API
  MAY change between Node minor versions outside normal semver), but is
  loadable without a runtime flag as of Node 24 and has a stable synchronous
  shape (`DatabaseSync`, `StatementSync`). This risk is accepted and
  controlled rather than avoided by native substitution: the `engines` field
  pins Node to `>=24 <25`, the record-store seam (§6) keeps `node:sqlite`
  behind the same provider-neutral interface as the PostgreSQL adapter so a
  future substitution would not change domain code, and a Node LTS upgrade
  that changes `node:sqlite` behavior requires the compatibility and
  regression evidence ADR-011 §7 already requires for any runtime upgrade.

## 9. Validation

- a new local Workspace creates a user-owned SQLite database without server
  dependencies
- state survives parent process restart and exact command retries do not
  duplicate lifecycle effects
- concurrent writers cannot silently overwrite revisions
- transaction failure cannot retain state without its event/outbox intent
- a Workspace cannot open or import another Workspace's state as authoritative
- child workers cannot mutate authoritative state directly
- multiple host bridges converge on one active local parent owner
- backup/restore, disk-full, corruption, lock contention, and deletion tests fail
  safely and retain actionable evidence
- SQLite and PostgreSQL adapters pass the shared repository contract suite before
  their respective profiles are enabled
