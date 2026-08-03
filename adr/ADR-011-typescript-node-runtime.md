---
id: ADR-011
title: TypeScript and Node.js Runtime Baseline
status: accepted
version: 1.0.0
date: 2026-08-03
decision_owners:
  - Architecture
  - Runtime Platform
related_specs:
  - SPEC-309
  - SPEC-310
  - SPEC-407
  - SPEC-410
  - SPEC-411
related_adrs:
  - ADR-003
  - ADR-007
  - ADR-009
supersedes: []
superseded_by: null
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/requirement-review-tracer-bullet/OWNER_APPROVAL.yaml
---

# ADR-011: TypeScript and Node.js Runtime Baseline

## 1. Context

QA Intelligence needs one initial implementation language that supports explicit contracts, structured schemas, asynchronous orchestration, Playwright integration, CLI and plugin development, and deterministic local tests without creating a polyglot operational baseline.

## 2. Decision

The initial tracer bullet and core runtime SHALL use:

- TypeScript with strict type checking and project-local pinned compiler
- ECMAScript modules
- Node.js 24 LTS, using the current security-patched minor in build and runtime images
- npm with a committed lockfile for the initial repository
- JSON Schema Draft 2020-12 for runtime data validation

The decision selects an implementation baseline, not a domain authority. Interfaces and schemas remain provider- and language-independent.

## 3. Rationale

- TypeScript provides compile-time contracts while preserving direct access to the Node and Playwright ecosystems.
- Node 24 is an LTS line supported by current Playwright releases.
- One runtime reduces build, deployment, observability, and contributor complexity for the first vertical slice.
- JSON Schema remains the cross-language contract; TypeScript types are generated or checked against it and SHALL NOT redefine it.

## 4. Module and Seam Rules

Agent Runtime and Evaluation Engine remain deep modules. Callers use SPEC-508 and SPEC-511 rather than framework-specific classes. Provider SDKs are restricted to adapters at existing seams. In-process pure logic does not receive unnecessary ports.

Every remote seam in the tracer bullet requires at least a production adapter and deterministic fake or replay adapter before the seam is considered real.

## 5. Consequences

- Python MAY be used for repository tooling already present, but production domain logic SHALL not be duplicated in Python.
- Browser automation reuses the existing Playwright Plugin contract.
- Runtime upgrades follow supported LTS lines and require compatibility and regression evidence.
- Native dependencies require architecture review because they reduce portability and reproducibility.

## 5.1 Alternatives Considered

- **Python-first runtime** was rejected for the initial slice because it would duplicate the TypeScript/Playwright toolchain and increase operational variety before proven need.
- **Polyglot TypeScript and Python from day one** was rejected because two production runtimes do not yet provide enough leverage to justify their build, contract, deployment, and observability cost.
- **Delay the language decision** was rejected because contract adapters, CI, and deterministic test harnesses require one executable baseline.

## 6. Reversal Criteria

Revisit this decision if a required capability cannot be implemented safely or operably in Node, if a second deployment language has proven lifecycle leverage, or if the chosen runtime loses required security or Playwright support. A reversal must preserve all JSON Schema and interface contracts or provide migrations.

## 7. Validation

- strict compilation and dependency lock pass in CI
- supported Node LTS image is pinned and scanned
- JSON Schema and contract tests run without provider SDKs
- production and fake/replay adapters pass the same conformance suites

## 8. References

- https://nodejs.org/en/about/previous-releases
- https://www.typescriptlang.org/download/
- https://playwright.dev/docs/intro
