---
id: GOV-011
title: Architecture Decision Graph
version: 1.1.0
status: accepted
owner:
  - Architecture
  - Engineering Governance
depends_on:
  - SPEC-001
  - SPEC-007
  - GOV-001
  - GOV-004
  - GOV-006
related_adrs:
  - ADR-001
  - ADR-002
  - ADR-003
  - ADR-004
  - ADR-005
  - ADR-006
  - ADR-007
  - ADR-008
  - ADR-009
  - ADR-010
  - ADR-011
  - ADR-017
  - ADR-013
  - ADR-014
  - ADR-015
  - ADR-016
  - ADR-018
last_updated: 2026-08-05
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/GOVERNANCE_REVIEW.yaml
---

# Architecture Decision Graph

## 1. Purpose

This document provides the human-readable decision graph connecting Foundation, ADRs, specifications, contracts, components, and runtime behavior.

The machine-readable source is `meta/REPOSITORY_GRAPH.yaml`.

## 2. Governing Flow

```text
Foundation and Governance
          ↓
Architecture Decisions
          ↓
Knowledge Specifications
          ↓
Product Specifications
          ↓
Architecture Specifications
          ↓
Interface Contracts
          ↓
Component Specifications
          ↓
Runtime Specifications
          ↓
Implementation and Evidence
```

## 3. ADR Realization

| Decision | Primary Realization |
|---|---|
| ADR-001 Knowledge Store | SPEC-102, SPEC-103, SPEC-401, SPEC-501 |
| ADR-002 Rule Engine Before LLM | SPEC-104, SPEC-203, SPEC-301, SPEC-308, SPEC-502 |
| ADR-003 Semantic UI | SPEC-201, SPEC-207, SPEC-302, SPEC-303, SPEC-407 |
| ADR-004 UI Knowledge Graph | SPEC-101, SPEC-201, SPEC-303, SPEC-307, SPEC-408 |
| ADR-005 Candidate Lifecycle | SPEC-102, SPEC-105, SPEC-403 |
| ADR-006 Discovery Before Asking | SPEC-201, SPEC-301, SPEC-308, SPEC-409 |
| ADR-007 Plugin as Adapter | SPEC-209, SPEC-305, SPEC-405, SPEC-407, SPEC-409, SPEC-503 |
| ADR-008 Workspace Isolation | SPEC-306, SPEC-406, SPEC-506 and every runtime specification |
| ADR-009 Execution Engine Abstraction | SPEC-210, SPEC-404, SPEC-504, SPEC-601–605 |
| ADR-010 Controlled Learning | SPEC-105, SPEC-211, SPEC-308, SPEC-605 |
| ADR-011 TypeScript and Node Runtime | SPEC-309, SPEC-310, SPEC-410, SPEC-411 |
| ADR-012 PostgreSQL and Outbox | Superseded by ADR-017; optional shared-profile history |
| ADR-013 Modular Monolith Deployment | SPEC-601, SPEC-603, SPEC-605 |
| ADR-014 OIDC and Internal Authorization | SPEC-306, SPEC-506, SPEC-606 |
| ADR-015 Requirement Review Tracer Bullet | SPEC-203, SPEC-213, SPEC-309, SPEC-310 |
| ADR-016 Host-Neutral MCP Integration | SPEC-508, SPEC-509, SPEC-510, SPEC-511 |
| ADR-017 Local-First SQLite and Optional PostgreSQL | SPEC-103, SPEC-309, SPEC-501, SPEC-601, SPEC-606, SPEC-607 |
| ADR-018 Memory, Proportional Rigor, and Cost/Latency Efficiency | SPEC-108, SPEC-001, SPEC-107, SPEC-206, SPEC-209, SPEC-210, SPEC-213, SPEC-309, SPEC-501, SPEC-508 |

## 3.1 Agent and Skill Realization

```text
SPEC-004 AI Governance
        ↓
SPEC-106 Agent and Skill Model ──→ SPEC-107 Evaluation Model
        ↓            ↓                     ↓
        ↓      SPEC-108 Memory      SPEC-213 Quality Assessment
        ↓            ↓                     ↓
SPEC-309 Agent Runtime ←──         SPEC-310 Evaluation Engine
        ↓                                  ↓
SPEC-508/509/510 Contracts         SPEC-511 Evaluation Contract
        ↓                                  ↓
SPEC-410 Agent Runner              SPEC-411 Evaluation Manager
        ↓                                  ↓
SPEC-606 Agent Lifecycle           SPEC-607 Campaign Lifecycle
```

SPEC-108 (Memory) extends SPEC-103's Knowledge Store ranking (not shown above; see §4 Contract Ownership) and is consumed by SPEC-309/SPEC-508 for context reuse. It does not introduce a second knowledge store or bypass SPEC-105's governed learning path.

These artifacts realize existing decisions. They do not introduce an independent generic Agent product, a second knowledge store, or a direct-learning path.

## 4. Contract Ownership

Normative contracts SHALL be owned once:

- ontology semantics: SPEC-101
- Knowledge Object lifecycle: SPEC-102
- deterministic rule semantics: SPEC-104
- product execution outcomes: SPEC-210
- Workspace context: SPEC-506
- plugin protocol: SPEC-503
- execution engine protocol: SPEC-504
- platform events: SPEC-505
- runtime execution transitions: SPEC-602
- Agent and Skill semantics: SPEC-106
- Memory and retrieval-layer semantics: SPEC-108
- evaluation semantics: SPEC-107
- Agent runtime protocol: SPEC-508
- Skill invocation protocol: SPEC-509
- Agent Tool protocol: SPEC-510
- evaluation adapter protocol: SPEC-511

Other artifacts SHALL reference these sources and define only their layer-specific responsibility.

## 5. Acceptance

This graph is accepted because the primary ADR realizations and critical contract/component/runtime edges are present in `meta/REPOSITORY_GRAPH.yaml`, complete normative dependencies remain in governed artifact front matter, ownership is registered, and automated unresolved-target and cycle validation passes.

The graph is navigation and impact-analysis metadata; it does not override the authoritative dependency or contract declarations in governed artifacts.
