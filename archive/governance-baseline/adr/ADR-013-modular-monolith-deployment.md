---
id: ADR-013
title: Modular Monolith and Worker Deployment Baseline
status: accepted
version: 2.0.0
date: 2026-08-03
decision_owners:
  - Architecture
  - Runtime Platform
  - Security
related_specs:
  - SPEC-304
  - SPEC-306
  - SPEC-309
  - SPEC-310
  - SPEC-601
  - SPEC-603
  - SPEC-604
  - SPEC-605
related_adrs:
  - ADR-007
  - ADR-008
  - ADR-009
  - ADR-011
  - ADR-017
supersedes: []
superseded_by: null
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/requirement-review-tracer-bullet/OWNER_APPROVAL.yaml
---

# ADR-013: Modular Monolith and Worker Deployment Baseline

## 1. Context

The platform needs durable asynchronous work and sandboxed evaluation, but the first advisory tracer bullet does not justify independently deployed microservices for each domain capability.

## 2. Decision

Start as one modular codebase with local-first and shared deployment profiles built from the same versioned release.

The default personal profile has:

1. one OS-user-owned local parent runtime for commands, queries, approvals,
   configuration, reports, lifecycle ownership, and durable state
2. bounded child worker or sandbox processes for Agent actions and evaluation
   trials; children return observations and never write authoritative state
3. local MCP bridges that connect Codex, Claude Code, Cursor, or CI to the same
   active parent owner for a Workspace

The local parent uses one SQLite database per Workspace according to ADR-017.
A single-host `stdio` profile MAY combine the MCP bridge and parent in one
process while holding the exclusive Workspace owner lease.

The optional shared/team profile retains separate control and worker process
roles deployed as immutable containers with PostgreSQL and authenticated remote
MCP. Sandbox execution MAY use a separate constrained container or process in
either profile while remaining governed by the Agent Runtime and Evaluation
interfaces.

## 3. Module Rules

Knowledge, Rule, Agent Runtime, Evaluation Engine, Workspace, and Plugin modules retain explicit interfaces and dependency direction inside the monolith. They SHALL NOT communicate through loopback network calls merely to imitate microservices. Deployment topology cannot redefine module ownership.

## 4. Reliability and Scaling

- local durable work is recoverable from SQLite checkpoints and local outbox
  state; shared work is recoverable from the selected conformant repository
- child workers hold no authoritative state between parent-owned checkpoints
- only the shared profile scales workers horizontally across machines
- per-Workspace quotas, admission control, fair work claiming, cancellation, and kill switches are mandatory
- control and worker roles expose health, readiness, metrics, logs, and trace correlation
- local upgrades use an exclusive owner lease plus reversible migration; shared
  deployment supports backward-compatible rolling migration or explicit
  maintenance mode

## 5. Consequences

This reduces operational complexity and preserves locality while allowing control and worker capacity to scale independently. A process failure has a wider initial blast radius than mature microservices, so resource limits and sandbox isolation are mandatory.

## 5.1 Alternatives Considered

- **Microservice per domain module** was rejected because network seams, distributed failure, and independent deployment provide no proven leverage for the first slice.
- **One uncontrolled process per host application** was rejected because hosts
  could race to own the same Workspace and SQLite file.
- **Children writing persistence directly** was rejected because parent Agent
  authority and recovery attribution would be lost.
- **Provider-specific serverless workflows** were rejected because they would leak deployment technology into runtime semantics and weaken local reproducibility.

## 6. Extraction Criteria

Create a remote seam only when a module requires independent scaling, security isolation, availability, release cadence, or ownership demonstrated by operational evidence. Extraction requires a production transport adapter and in-memory/replay test adapter through the same interface.

## 7. Validation

- local deterministic environment starts with SQLite and without cloud or
  database-server dependencies
- Codex, Claude Code, and Cursor converge on one active local parent owner
- child workers cannot advance authoritative lifecycle state directly
- worker loss, duplicate delivery, cancellation, rolling deployment, migration, and recovery tests pass
- sandbox cannot reach unauthorized network, credentials, filesystem, or Workspace data
- independent control and worker scaling preserves fairness and evidence
