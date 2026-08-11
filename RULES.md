# Expert Tester — non-negotiable rules

These rules bind the MCP agent and every contributor. Short on purpose.
Contracts live in TypeScript (`src/**/public.ts`), not in archived SPECs.

## Honesty

1. **No fabricated pass.** Never claim green when `release_recommendation` is not a release-friendly gate.
2. **No invented root cause.** Pipeline may set `suspected_cause` only. Never set `confirmed_cause`.
3. **No silent coverage.** Unbound AC, `not_executed`, and scope limits must appear in `coverage_gaps` / findings — never counted as pass.
4. **Scope honesty.** Naming smoke ≠ WCAG. API smoke ≠ full authz matrix. Never claim load/pen-test coverage not run.

## Evidence

5. **Fail with evidence.** Failed UI runs leave screenshot and/or Playwright trace under `.qa-traces/`.
6. **Defects need evidence.** Export/file path must warn when a draft has empty evidence.
7. **Secrets off the wire.** After `register_workspace_secret`, use `*_secret_ref` — never paste passwords into tool input.

## Design

8. **Semantic UI, not CSS.** Interaction targets resolve by accessible name/role from discovery — not freehand selectors.
9. **Deterministic first.** Rules and observed outcomes beat LLM storytelling.
10. **Learning never auto-promotes.** `avoid:*` hints and learning candidates are advisory until a human acts.

## Host Skills

Skills under `hosts/*/skills/` must teach **risk-first triage** (assess → choose strategy → run → read gate), not a tool shopping list.
