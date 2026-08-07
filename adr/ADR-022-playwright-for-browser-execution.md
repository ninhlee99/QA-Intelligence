---
id: ADR-022
title: Adopt Playwright for Real Browser Execution (SPEC-407/SPEC-504)
status: accepted
version: 1.0.0
date: 2026-08-06
decision_owners:
  - Architecture
  - Quality Engineering
  - Security
related_specs:
  - SPEC-407
  - SPEC-504
  - SPEC-301
  - SPEC-302
  - SPEC-303
related_adrs:
  - ADR-003
  - ADR-007
  - ADR-009
  - ADR-011
supersedes: []
superseded_by: null
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/playwright-execution-engine/CHANGE_IMPACT.yaml
---

# ADR-022: Adopt Playwright for Real Browser Execution (SPEC-407/SPEC-504)

## 1. Context

SPEC-407 (Playwright Plugin Component) and SPEC-504 (Execution Engine Contract) have both had a provider-neutral interface and a deterministic reference adapter since earlier increments (`src/execution-engine/public.ts`, `DeterministicExecutionEngine`), but no adapter that drives a real browser. Building one previously stalled on a real, verified blocker: SPEC-407 §2/§3 requires semantic locate/interact against governed UI evidence (ADR-003, "Semantic UI Instead of Raw DOM"), which itself required SPEC-301 (Semantic Analyzer), SPEC-302 (DOM Cleaner), SPEC-303 (Feature Extractor), and SPEC-408 (Ontology Repository) to exist first — a Playwright adapter built before them could only fall back to raw CSS/XPath selectors, violating ADR-003 outright. All four now exist (interface + deterministic adapter + contract suite, proven end-to-end through a real three-stage pipeline test with no mocks). That blocker is closed at the design level; what remains is the browser-automation technology decision itself.

## 2. Decision

Adopt `playwright` (the full package, not `playwright-core` alone, so the bundled browser binaries and its own auto-install/version-pinning mechanism are available) as a runtime dependency, scoped to a new `src/adapters/playwright/` Execution Engine adapter implementing `ExecutionEngine` (`src/execution-engine/public.ts`) — the same interface `DeterministicExecutionEngine` already implements, so orchestration code above this seam never imports Playwright directly (ADR-009 §4.2 "Technology Independence").

## 3. Rationale

- **Ecosystem-standard, not a niche choice.** Playwright is Microsoft-maintained, the most widely used cross-browser automation library in the current Node ecosystem, and is already SPEC-407 §8's own named default ("Playwright is the default execution engine for web application testing," ADR-009 §4.3). This is not introducing a new technology choice — it is finally implementing a choice this repository's specs already made and have been waiting on.
- **A hand-rolled browser automation layer is categorically the wrong call.** Unlike ADR-019's JSON-RPC/`stdio` decision (a small, bounded protocol a correct in-house implementation could realistically cover), driving Chromium/Firefox/WebKit via their native automation protocols (CDP, and the Firefox/WebKit equivalents) is not a bounded surface — it spans process lifecycle, network interception, accessibility tree extraction, screenshot/video/trace capture, and per-engine protocol differences. This is the same category of "real, complex, already-solved technology" ADR-017/018 already used to justify adopting `pg` over reimplementing a database wire protocol.
- **`playwright-core`'s own dependency footprint is minimal** — a single dependency (`playwright-core` itself, bundled), no transitive sprawl the way `@modelcontextprotocol/sdk` has. This clears the same ADR-011 §5 "small, auditable dependency set" bar `pg`, `jose`, and `js-yaml` already cleared.
- **The Semantic UI pipeline this adapter feeds already exists and is tested.** `DeterministicDomCleaner` → `DeterministicSemanticAnalyzer` → `DeterministicFeatureExtractor` proved the pipeline mechanics against synthetic `RawDomNode` trees; a Playwright adapter's job is narrower than building that pipeline — it only needs to produce a real `RawDomNode`-shaped capture from a real page (via Playwright's accessibility-tree and DOM-snapshot APIs) and feed it through the pipeline that already exists.

## 4. Decision Rules

- Playwright SHALL be imported only inside `src/adapters/playwright/` — no module outside that directory imports `playwright` directly, mirroring the one-seam-one-technology pattern ADR-021 already established for `js-yaml`.
- The Playwright adapter SHALL implement `ExecutionEngine` (SPEC-504 §2) and pass the exact same `runExecutionEngineContract` shared conformance suite `DeterministicExecutionEngine` already passes (SPEC-504 §7: "Production engines and a deterministic simulator/replay engine SHALL pass identical... tests") — no adapter-specific relaxation of that contract.
- Selector/locate logic SHALL go through the Semantic UI pipeline (SPEC-301/302/303) this repository already built — the adapter SHALL NOT introduce a second, raw-selector code path "for convenience," which would silently reintroduce the ADR-003 violation this decision exists to avoid.
- Browser binary installation (Playwright's own `npx playwright install`) is a build/CI concern, not something this adapter's runtime code SHALL perform implicitly on first use — an uninstalled browser SHALL fail closed with a clear `infrastructure_failure`/`unavailable` diagnosis, never a silent hang.
- Credentials, downloads, and network access SHALL be policy-controlled per SPEC-407 §4 — the adapter SHALL NOT expose a raw Playwright `BrowserContext` or `Page` object to any caller above the seam.

## 5. Alternatives Considered

- **Continue with only the deterministic adapter, indefinitely** was rejected: the deterministic adapter exists specifically to unblock contract/lifecycle testing (SPEC-504 §7), not to replace real execution — a platform whose only "test agent" capability is a simulator that never touches a real page cannot deliver SPEC-006's stated vision.
- **Selenium or a raw CDP client instead of Playwright** was rejected: Playwright already handles cross-engine (Chromium/Firefox/WebKit) automation, auto-waiting, and accessibility-tree extraction that a raw CDP client would require reimplementing per engine; Selenium's WebDriver protocol has a heavier multi-package footprint and weaker first-class accessibility-tree support than Playwright's.
- **Cypress** was rejected: Cypress runs tests inside the browser's own process model (not true cross-process automation the way Playwright/CDP is), which conflicts with SPEC-407 §4's "Browser contexts SHALL be isolated per execution scope" and multi-page/multi-context control requirement (§3).

## 6. Consequences

- QA Intelligence gains a real browser execution path for the first time — every capability built so far (Requirement Review through Judge calibration) has been advisory/document-review; this is the first step toward capabilities that actually execute a test.
- Runtime dependency count grows by one direct package (`playwright`) plus its bundled browser binaries (a build-time/CI concern, not a source dependency).
- CI and local development environments now need Playwright's browser binaries installed before the real adapter's tests can run — the deterministic adapter and its existing test suite remain fully runnable without them, so `npm test` stays browser-free by default (mirroring how the PostgreSQL real-driver tests already skip cleanly without a live database).
- Production enablement remains blocked on GOV-012 G1-G4 regardless of this decision (ADR-016 §8) — this ADR authorizes building and conformance-testing the adapter, not enabling it in production ahead of that gate.

## 7. Validation

- the Playwright adapter passes the exact same `runExecutionEngineContract` suite the deterministic adapter passes
- a real page capture, cleaned by `DeterministicDomCleaner`, analyzed by `DeterministicSemanticAnalyzer`, and extracted by `DeterministicFeatureExtractor`, produces real `FeatureCandidate`s from a real browser — not only from synthetic fixtures
- no module outside `src/adapters/playwright/` imports `playwright`
- an uninstalled or unreachable browser fails closed with a distinct, diagnosable failure code, never a silent hang or crash
- `npm test` (no browser installed) remains fully green; only an explicitly gated real-driver suite requires Playwright's browsers
