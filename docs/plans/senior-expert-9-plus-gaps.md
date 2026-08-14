# Path to 9/10 across every skill — orchestration & CI-gate gaps

Reviewed: 2026-08-13, from an external cross-project audit (dev-workflow plugin author,
who independently built `check-gates.sh` — a machine gate for a sibling delivery pipeline —
and is comparing design choices, not re-scoring what `PRODUCT-AUDIT.md` already measured).

**Relationship to existing docs:** this does not replace `PRODUCT-AUDIT.md` (2026-08-13) or
`senior-expert-ceiling.md`. Both are trusted — the 90% benchmark (`npm run benchmark:qa-qc`)
was re-run and reproduced (90% supported, target met, all proof-ref tests green) before writing
this file. This adds two gaps neither existing doc names, found by reading `hosts/claude-code/skills/*/SKILL.md`
against `PRODUCT-AUDIT.md`'s own Priority backlog and finding what the backlog doesn't cover.

## Why the average skill score sits at 7.5–8/10 and not 9/10

`PRODUCT-AUDIT.md`'s Skill audit table averages ~8/10 across 9 skills. The individual
tool/skill engineering is not what's holding the average down — `validate_expert_claim` (9/10),
`generate_test_cases` (8/10), the flake taxonomy, the domain-pack gate are all real, tested,
and independently verified (MCP `tools/list` returned 62 live tools; `expert-checklist.ts`
read directly, not inferred from docs). What's missing is **two system-level layers that sit
above the 8 skills**, not inside any one of them — the same two layers that took `dev-workflow`'s
weakest gates (G2, G4, G6 — previously 3-4/10) up to 8-9/10: **(1)** something that enforces the
*order* skills run in, and **(2)** something that verifies the *output artifacts* independently
of the same AI session that produced them.

---

## Gap 1 — No orchestrator enforcing skill sequence

### Evidence

Every skill's SKILL.md ends its flow with a soft handoff line:

- `qa/SKILL.md` line 17: "hand exact `test_cases`, ... to `$qc`"
- `testcase/SKILL.md` line 26: "so `$qc`, `$test`, or `$dev` can execute it without regeneration"
- `qc/SKILL.md` line 13: "For a QA handoff, call `execute_generated_test_case`..."

`$qc` / `$qa` / `$dev` is prose, not an invocation the runtime enforces. Nothing stops an agent
from calling `qc` directly on a URL with no prior `qa`/`testcase` pass, skipping requirement
review and risk analysis entirely — the skill will run and produce a plausible-looking result,
because `qc` doesn't verify a `testcase_design_sha256` was actually supplied by an upstream `qa`
run before it executes. The design intent (QA prevents, QC executes, defect-triage classifies,
qa-lead governs) is sound and matches how real QA orgs split responsibility — but intent living
only in skill-description prose is exactly the failure mode `RULES.md` and
`expert-tester-workflow.md` are otherwise strict about avoiding everywhere else (no invented
pass, no fabricated cause, no silent skip).

### Comparable fix already proven elsewhere

`dev-workflow:start` is a thin dispatcher: it reads gate status from a structured file
(`INDEX.md`) and refuses to jump ahead — `:build` explicitly "Refuses production code if gates
fail" by checking prior-stage PASS marks before doing anything, not by trusting the caller
picked the right stage. That pattern transfers directly:

### Proposed change

1. Add a 9th artifact type (or reuse `register_knowledge_record`) — a **session ledger** per
   test request: which skill ran, in what order, with what `testcase_design_sha256` / `suite_id`
   / `expert_checklist` snapshot at each step.
2. `qc` (and `execute_generated_test_case`) checks the ledger before executing: if scope is
   "defined QA/QC test scope" per its own description, it should refuse (or downgrade to
   `assisted`/exploratory footing) when no upstream `qa`/`testcase` ledger entry exists for the
   same requirement/AC reference — the same shape as `dev-workflow` G6 refusing build claims
   without a prior G4 plan.
3. Add a thin `qa-intelligence:start` (or extend `qa-lead`) that dispatches from ledger state,
   mirroring `dev-workflow:start`'s "run from first failing gate" — not a new execution engine,
   just a sequencing check in front of the 8 existing skills.

This directly targets `PRODUCT-AUDIT.md`'s own P0 items (`run_regression_suite` checkpoint/resume,
suite parity) — a ledger is the natural place checkpoint/resume state already needs to live, so
this is not competing scope with the existing Priority backlog, it's the shared substrate two of
those P0 items already need.

---

## Gap 2 — No CI-external structural gate on artifacts

### Evidence

`validate_expert_claim` is real and enforced — but it is called *by the same agent session*
that produced the `expert_checklist` it's validating, inside the same MCP round-trip. There is
no equivalent of `check-gates.sh`: a separate process, runnable in CI with no LLM involved, that
re-opens the artifact files (testcase design JSON, evidence manifest, `expert_session_report`)
after the session ends and independently confirms structural claims — SHA present and matching
git HEAD, evidence manifest paths actually exist on disk, `release_recommendation` first line
matches the machine-derived checklist, no placeholder text in defect drafts.

This is the same trust boundary `dev-workflow`'s `:audit` skill was built to close: an AI's own
verdict on its own work is necessary but not sufficient — not because the AI is presumed
dishonest, but because a second, independent, cheaper check catches slips (wrong file path,
stale SHA, a `not_executed` case counted as `passed` by a formatting bug) that the *same*
reasoning pass structurally cannot see in itself. `dev-workflow` learned this the concrete way:
building `check-gates.sh`'s G2/G4/G6 checks surfaced three real logic bugs during construction
(a POSIX-awk `/i`-suffix that isn't a flag, a header row silently matching a data-row pattern, a
Python regex without a word-boundary that matched "na" inside "Canary" instead of the real "N/A")
— bugs a single authoring pass did not catch, that a second independent check did.

### Proposed change

1. A standalone script (`scripts/verify-qa-artifacts.mjs`, same family as the existing
   `scripts/run-*-benchmark.mjs` and `scripts/check-production-readiness.mjs`) that takes a
   session's output directory and re-derives `claim_pass_allowed` from the artifact files on
   disk — not from the `expert_checklist` object the session already computed — then diffs the
   two. A mismatch is the bug class this catches; it should never happen if the session was
   honest, which is exactly why it's worth checking.
2. Wire it as a `npm run verify:qa-session <path>` companion to the existing `benchmark:*`
   scripts, and as a documented pre-merge step in any host CI, the same way `check-gates.sh
   --min G9 --strict` is documented as the pre-merge command in `dev-workflow`'s USER-GUIDE.md.
3. This is a natural fit for `PRODUCT-AUDIT.md`'s P0 "bring `run_regression_suite` to standard
   evidence, manifest and JSON/CSV parity" — the parity check and the independent verify script
   can share the same manifest-reading code.

---

## What this does NOT propose

- Does not touch the 3 `assisted` tasks (`qa-risk-strategy`, `qa-data-readiness`,
  `qc-exploratory`) or the 2 `human_only` tasks (`human-release-accountability`,
  `human-certification`) in `qa-qc-work-coverage.json` — those limitations are correctly
  reasoned (novel-domain judgment, business-valid data ownership, usability judgment) and
  should stay assisted/human, not be automated away.
- Does not re-litigate any `PRODUCT-AUDIT.md` rating — those were independently reproduced via
  the benchmark run and read as trustworthy.
- Does not propose a new skill or MCP tool surface beyond what's already planned in the P0/P1
  backlog — both gaps above are framed as extensions of backlog items 1 and 2
  (`run_regression_suite` parity, checkpoint/resume) already prioritized in `PRODUCT-AUDIT.md`.

## Expected effect on scores

| Area (from PRODUCT-AUDIT.md) | Current | After Gap 1 + Gap 2 | Why |
|---|---|---|---|
| QA/QC workflow | 8.5/10 | 9/10 | Sequence is enforced, not just documented |
| Defined-suite execution | 6/10 | 8/10 | Ledger gives checkpoint/resume substrate P0 already needs |
| Production operations | 6/10 | 8/10 | CI-external verify script is the missing piece for release gating |
| `qc` skill | 8/10 | 9/10 | Refuses to run ahead of an upstream `qa`/`testcase` ledger entry |
| Skill audit average | ~8/10 | ~9/10 | System-level enforcement lifts every skill that currently depends on prose-only handoff discipline |

Neither gap requires new MCP capability — both are process/verification layers on top of tools
that already exist and already work. That is deliberate: the 62 live tools and their tested
logic are the hard part, already done well. What's missing is the same thing `dev-workflow` was
missing before this pass — the layer that stops trusting the session to have followed the
sequence and the claims it made about its own output.
