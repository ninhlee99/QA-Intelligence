---
id: ADR-021
title: Adopt js-yaml for the Ontology Repository Component
status: accepted
version: 1.0.0
date: 2026-08-06
decision_owners:
  - Architecture
  - Ontology Steward
related_specs:
  - SPEC-101
  - SPEC-408
  - SPEC-501
related_adrs:
  - ADR-011
  - ADR-019
supersedes: []
superseded_by: null
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/ontology-repository/CHANGE_IMPACT.yaml
---

# ADR-021: Adopt js-yaml for the Ontology Repository Component

## 1. Context

SPEC-408 (Ontology Repository Component) requires a component that "load[s] and validate[s] machine-readable ontology releases" from the canonical serialization SPEC-408 §9 already names: "the versioned YAML structure under `ontology/`, indexed by `meta/ONTOLOGY_INDEX.yaml`." That YAML data already exists and is already accepted (`ontology/entities/core.yaml`, `ontology/relationships/core.yaml`, `ontology/enumerations/lifecycle.yaml`, `ontology/constraints/core.yaml`) and already validated by the Python governance tooling (`tests/validate_repository.py` uses PyYAML). No TypeScript runtime dependency parses YAML today — the two existing production dependencies are `ajv`/`ajv-formats` (JSON Schema) plus `pg` (ADR-017) and `jose` (ADR-014), none of which read YAML.

## 2. Decision

Add `js-yaml` (plus its `@types/js-yaml` dev-time types) as a runtime dependency for the Ontology Repository component (`src/ontology/`) and any future module that needs to read this repository's accepted YAML ontology/spec-adjacent artifacts.

## 3. Rationale

- **Correctness over reimplementation risk.** ADR-019 chose to hand-roll a minimal JSON-RPC/`stdio` transport instead of adopting the full MCP SDK, but that decision rested on JSON-RPC framing being a small, bounded, well-specified surface (newline-delimited JSON, a handful of methods) that a correct in-house implementation could realistically cover end-to-end. YAML is not that: the full specification includes anchors/aliases, multiple scalar styles, block and flow collections, tag resolution, and numerous edge cases in string/number/date implicit typing. `ontology/*.yaml` today only uses a narrow, disciplined subset (flat `key: value` plus single-line flow-style arrays of objects), but nothing prevents a future ontology release from using block-style YAML, multi-line strings, or anchors as the ontology grows — a hand-rolled "parser for the subset we use today" would either silently mis-parse a legitimate future file or require constant expansion chasing YAML's real grammar. This is closer to ADR-017/018's `pg` decision (a real wire protocol not worth reimplementing) than ADR-019's JSON-RPC decision.
- **`js-yaml` is small and dependency-light.** It has exactly one transitive dependency (`argparse`), is pure JavaScript with no native binding (consistent with ADR-011 §5's portability requirement, the same bar `pg` and `jose` already cleared), and is the de facto standard YAML parser in the Node ecosystem — widely audited, not a niche or unmaintained package.
- **Read-only, one-directional use.** The Ontology Repository only needs to *read* the already-accepted YAML files this repository's own governance process produces and validates (via the Python/PyYAML path) — it does not need to *write* YAML, preserve comments, or round-trip formatting. This is the narrowest possible use of a YAML library, not a general document-editing dependency.

## 4. Decision Rules

- `js-yaml`'s `load()` (safe by default in the current major version — no arbitrary type/function construction from untrusted YAML) SHALL be used, never a `loadAll`/custom-schema variant that widens what a YAML document can construct into.
- The Ontology Repository SHALL treat every YAML file under `ontology/` as already-trusted, already-governance-reviewed content (the same trust boundary `meta/*.yaml` index files already have via the Python validator) — this dependency is not being added to parse untrusted, external, or Workspace-supplied YAML.
- No other module SHALL depend on `js-yaml` directly; only the Ontology Repository component imports it, keeping the "one seam owns one technology" pattern ADR-007/ADR-009 already establish for other adapters.

## 5. Alternatives Considered

- **Hand-roll a parser for the current flow-style subset** was rejected per §3 — the risk of silently mis-parsing a legitimate future ontology release (block-style YAML, multi-line rule descriptions, anchors) is disproportionate to the effort saved, unlike ADR-019's JSON-RPC case where the full protocol surface really was small and bounded.
- **Convert `ontology/*.yaml` to JSON and drop YAML entirely** was rejected: the files are accepted, governance-reviewed artifacts SPEC-408 §9 already names as canonical; changing their format is a spec-level decision affecting the Python validator and every other consumer, not a TypeScript dependency choice, and out of scope here.
- **Read the ontology only through the existing Python validator's output** (e.g., have Python emit a JSON snapshot the TypeScript component reads) was rejected: it would make a runtime TypeScript component depend on a build-time Python step succeeding and staying in sync, a fragile cross-language coupling worse than a small, well-understood npm dependency.

## 6. Consequences

- The Ontology Repository component can parse `ontology/*.yaml` directly and correctly, including any future legitimate YAML feature use, without a bespoke parser needing ongoing maintenance as the ontology grows.
- Runtime dependency count grows by one direct package (`js-yaml`) plus one transitive (`argparse`), both pure JavaScript.
- Every other module in the repository remains YAML-free; only `src/ontology/` imports `js-yaml`.

## 7. Validation

- `js-yaml`'s `load()` correctly parses all four existing `ontology/*.yaml` files into the shapes the Ontology Repository's types expect
- a malformed or unparseable YAML file fails closed with a structured error, never a crash
- no module outside `src/ontology/` imports `js-yaml`
- `npm audit` reports no high-severity vulnerability in `js-yaml` or `argparse`
