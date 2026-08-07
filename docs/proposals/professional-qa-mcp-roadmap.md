---
status: proposal — not governed, not a SPEC
last_updated: 2026-08-07
---

# Roadmap: MCP as a professional QA test engineer

> **Not governed.** Lives under `docs/proposals/`, outside `specs/`, so it is
> excluded from `tests/validate_repository.py` and every `meta/*.yaml` index.
> This is a working plan across sessions, not an accepted architecture
> decision. Each phase below still produces (or extends) a real accepted
> SPEC/ADR when it lands — this file just sequences the work.

## The goal, stated precisely

Today, using `qa-intelligence-remote` "as a professional test engineer"
means one MCP call (`assess_requirement_quality`) plus one tracer-bullet
call (`execute_browser_test`, navigate+assert only, seeded fixture data).
The target is: install this MCP into any host (Claude Code, Cursor, Codex),
point it at a real product, and get requirement review, risk-aware test
design, real test cases with real evidence, and real execution — without
hand-holding the AI through the app first.

That requires three capabilities the repository has *specified* but not yet
*connected*, in this dependency order:

```text
Discovery              Interaction              Test Design -> Execution
(what does the UI      (can the engine act      (turn requirements + UI
 actually contain?)     on what it found?)        knowledge into real,
                                                    evidenced test runs)
     |                       |                          |
     v                       v                          v
SPEC-201, SPEC-101      ADR-022 (needs           SPEC-206, SPEC-207,
SPEC-301 (Semantic      revision), SPEC-407,     SPEC-210 (already
Analyzer)               SPEC-504                 wired for execution)
```

The order is load-bearing, not arbitrary: a generated test case is useless
without knowing what's on the page (Discovery), and a discovered page is
untestable if the engine can only look, not act (Interaction). Building the
generation chain (Phase 3) before the other two — which is what the user's
original SPEC-512 draft did — produces test cases that describe a UI the
platform still can't perceive or touch.

## Ground truth already in the repo (read, not assumed)

- `PlaywrightExecutionEngine` (`src/adapters/playwright/`) navigates a URL
  and runs one boolean assertion against a cleaned Semantic UI tree. It does
  not type, click, or hold session state across steps (ADR-022 §4, by
  design — raw selector interaction was explicitly rejected to keep
  assertions selector-independent).
- `extractRawDom` + `DeterministicDomCleaner` (`src/dom-cleaner/`) already
  turn a live page into `CleanedDomNode` (role, accessible_name, text,
  children) — this is the raw material Discovery needs, but nothing calls
  it for discovery purposes today.
- `src/discovery/public.ts` line 60 says outright: *"Semantic UI Map/Product
  Surface Map are out of scope for this slice — no browser/Platform Plugin
  adapter exists yet."* `DiscoverProductContext` only searches the Knowledge
  Store's existing text; it has never looked at a live page.
- SPEC-206 (Test Strategy), SPEC-207 (Test Design) are accepted specs with
  no corresponding `src/` implementation directories at all — pure paper
  today.
- The Requirement Review Agent (`src/requirement-review/`) is the only
  capability wired end-to-end (Skill -> Runtime Executor -> MCP tool). It is
  the template every phase below copies.

## Phase 1 — Discovery: let the platform see a real page

**Status: tracer bullet done and verified live (2026-08-07).** `discover_ui_surface` runs through the real remote MCP transport (not just unit tests) and correctly maps a fixture login page's Username field and Sign in action. Remaining scope (multi-page crawl, Region/Validation/Navigation/Workflow/State/Permission, role-based discovery) intentionally deferred — see "Explicitly not in Phase 1" below.


**Extends:** SPEC-201 §8 (Semantic UI Discovery), SPEC-101 (ontology:
Page/Region/Feature/Field/Action/Validation/Navigation/State/Permission).

**What's missing:** a Discovery adapter that drives `PlaywrightExecutionEngine`
(or a sibling read-only engine) to navigate a URL, run it through
`DeterministicDomCleaner`, and map the resulting tree into SPEC-101 semantic
concepts — not raw selectors. Today's `DiscoverProductContext` never touches
a browser.

**Tracer bullet deliverable:**
- `src/discovery/discover-ui-surface.ts` — new Skill: given a URL and
  Workspace context, navigate (read-only, no interaction) and emit a
  `SemanticUiMap` fragment (Pages/Features/Fields/Actions with
  `accessible_name`/`role`, confidence, source observation) extending
  `DiscoveryReport`.
- A new `SemanticUiMap` type added to `src/discovery/public.ts`, replacing
  today's "out of scope" comment.
- Runtime wiring + MCP tool `discover_ui_surface`, following the
  `CompositeAgentRunExecutor` pattern already in place from the browser-test
  work.
- Integration test: point at a multi-element fixture page, assert the
  emitted map contains the right Page/Field/Action entries with correct
  `accessible_name` provenance.

**Definition of done:** given only a URL, the platform produces a
Semantic UI Map an AI (or a human) can read to know what's testable on that
page — without a human first describing the page in prose.

**Explicitly not in Phase 1:** multi-page crawling, authenticated discovery,
role-based behavior discovery (SPEC-201 §8's "role and environment
applicability" — deferred until Phase 2 makes login possible).

## Phase 2 — Interaction: let the engine act, not just look

**Status: tracer bullet done (2026-08-07).** `PlaywrightExecutionPlan.steps` (type/click, resolved by accessible name/role through `page.getByRole`, validated against a fresh `CleanedDomNode` capture before each action) is implemented and passes 3 real-Chromium tests: a full login flow reaching a post-login-only page, fail-closed on a nonexistent target, and secret-ref indirection (the literal password never appears in the plan or MCP call — resolved via a `SecretResolver` dependency). Wired into the MCP server as a second seeded plan (`TC-DEMO-002`). Real-environment credential registry (naming a Workspace's actual staging secrets, not a hardcoded demo one) remains Phase 3 scope.


**Revises:** ADR-022 §4 (currently forbids raw selector interaction — this
phase does not reopen raw selectors, it adds *semantic* interaction bound to
what Phase 1's Discovery already resolved).

**What's missing:** `PlaywrightExecutionPlan.assert` is read-only. There is
no `type`, `click`, `select`, or session/cookie continuity across steps.
Login — the single most common test precondition — is impossible today.

**The constraint that makes this safe, not a regression:** interaction
targets SHALL resolve through the same `CleanedDomNode` (`accessible_name`/
`role`) Discovery already produces — never a raw CSS/XPath selector a plan
author writes freehand. This preserves ADR-003/ADR-022's "selectors are
evidence, not product meaning" invariant while adding real capability.

**Tracer bullet deliverable:**
- Extend `ExecutionEngineOperationMap`'s `start` payload (SPEC-504) with an
  ordered list of semantic interaction steps (`type_into(field_by_name)`,
  `click(action_by_name)`, `wait_for(state)`), each resolved against the
  cleaned tree before acting.
- `PlaywrightExecutionEngine.start` executes the step sequence, capturing an
  `evidence_created` event per step (screenshot/DOM snapshot), before the
  final assertion.
- A credential-injection seam (SPEC-407 §4 "approved injection") so a plan
  can reference a Workspace-scoped credential without the MCP caller ever
  seeing the raw secret — this is what makes the daijob staging basic-auth
  case eventually possible without a Host handling passwords.
- Contract test additions to `runExecutionEngineContract` covering a
  multi-step login-shaped flow against a fixture page (form + redirect).

**Definition of done:** a plan can log into a fixture app (username/password
fields resolved semantically, not by selector) and reach a page only
visible post-login, with full step-by-step evidence.

**Explicitly not in Phase 2:** the real daijob staging environment
specifically (that requires Phase 3's environment/credential registry too)
— this phase proves the *engine* can interact, on a controlled fixture.

## Phase 3 — Test Design → Execution: the professional workflow, closed

**Status: tracer bullet done, including negative/boundary/adversarial variants and a real execution path (2026-08-07).** `src/test-design/generate-test-cases.ts` composes Discovery (Phase 1) and a Requirement's acceptance criteria into governed `TestCase` records via one MCP tool, `generate_test_cases`. Per SPEC-207 §3/§4 ("normal, alternate, boundary, and failure behavior SHALL be considered"), a bindable criterion with an `expected_text` now produces up to four variants per editable field, not one happy-path case: `positive`, `negative` (wrong value, success text SHALL be absent), `boundary` (oversized input, no leaked system-error text), and `adversarial` (a benign, standard XSS/SQLi probe — `<img src=x onerror=alert(1)>`, `' OR '1'='1'` — checked for both unescaped reflection and actual script execution via dialog detection). A criterion with no matching UI element still produces a finding, never a fabricated test case (`tests/integration/generate-test-cases-runtime.test.ts`).

`src/test-design/to-execution-plan.ts` converts a generated `TestCase` straight into a `PlaywrightExecutionPlan`, closing the requirement→evidence loop end to end. `tests/test-design/generated-variants-execution.test.ts` proves this against two real Chromium pages: all four variants pass against a safely-built login form, and — critically — the adversarial variant actually **fails** (catches the bug) against a page with a real, unescaped `innerHTML` XSS vulnerability, while the same page's positive case alone would have passed and missed it. This required fixing a real timing bug in `PlaywrightExecutionEngine`: a click-triggered async handler (dialog, DOM mutation) could race ahead of the very next interaction step or the final assertion capture with no wait at all — a `waitForTimeout(200)` after every click closes that gap.

Real environment/credential registry (for the actual daijob staging target, not the demo fixture) remains open — see below.


**Implements:** SPEC-207 (Test Design), wired to the already-working
SPEC-210 execution path from the earlier tracer bullet.

**Correction (2026-08-07):** this section originally said SPEC-206/207 had
"no `src/` at all" — wrong. `src/test-strategy/assess-test-strategy-quality.ts`,
`src/test-design/assess-test-case-quality.ts`, and
`src/test-data/assess-test-dataset-quality.ts` already existed (committed
2026-08-06, before this roadmap was written) — each a full quality
*assessor* for an already-authored artifact, following the same
authorize→rule-evaluate→assess pattern as Requirement Review. What was
actually missing, and still is the real Phase 3 gap: nothing *generates* a
TestCase in the first place. A human still hand-authors both the TestCase
and the `PlaywrightExecutionPlan` that executes it.

**Tracer bullet deliverable:**
- `src/test-design/generate-test-cases.ts` — Skill taking a reviewed
  Requirement (Phase-1-of-earlier-work) + a `SemanticUiMap` (this roadmap's
  Phase 1) and producing governed `TestCase` records: preconditions (using
  Phase 2's interaction steps), steps, expected assertions, referencing
  SPEC-210's `ExecutionOutcome` vocabulary — not free-text.
- Each generated `TestCase` is Rule-Engine-checked before use (ADR-002:
  deterministic rules first) — e.g. "every acceptance criterion has at
  least one covering test case" — with LLM reasoning only for the parts
  rules can't decide, per SPEC-002/ADR-002.
- Wire the generated `TestCase` straight into the existing
  `ExecuteBrowserTest` -> `PlaywrightExecutionEngine` path (already built) —
  no new execution code needed here, only a new *source* of
  `PlaywrightExecutionPlan`s instead of hand-authored ones.
- Environment/credential registry (SPEC-512's proposal, §12) so a Workspace
  can register `companytools-staging.daijob.com` + its basic-auth credential
  once, and generated test cases reference it by name — never raw
  credentials over MCP.

**Definition of done:** given a requirement reference and a target URL, the
platform reviews the requirement, discovers the relevant UI, generates a
test case with governed acceptance criteria, executes it with real
interaction, and returns a SPEC-210 outcome with linked evidence — one
composed MCP call, no hand-authored plan.

**What this still does not claim:** "catches every bug." No test engineer,
human or AI, has that property. What it does claim, and what distinguishes
it from ad hoc browser automation: every step is traceable to a
requirement, every assertion is rule-checked before it runs, every result
carries evidence, and nothing here fabricates a passing result it didn't
observe (SPEC-210 §4's `indeterminate`/`infrastructure_error` exist
precisely so the system never claims false confidence).

## Sequencing notes for whoever picks this up next

- Each phase is a vertical slice like Requirement Review — Skill, Runtime
  Executor, MCP tool, integration test — not a horizontal layer across all
  three phases at once.
- Every phase's MCP tool registration goes through
  `CompositeAgentRunExecutor` (already built), keyed by a new Agent id —
  never a new `InMemoryAgentRuntime` instance.
- Promotion of any of this from `docs/proposals/` into `specs/` as a real,
  accepted SPEC requires Repository Owner sign-off and governance review
  evidence (SPEC-007 §15) — same constraint that kept SPEC-512 a proposal.
- GOV-012 gates (G1–G4 minimum) still block production enablement per
  ADR-016 §8, regardless of how complete the dev-only tracer bullets get.
