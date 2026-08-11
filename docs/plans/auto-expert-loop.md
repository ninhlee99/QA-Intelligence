# Plan: Fully automated Expert Tester loop

Goal: minimize host “remember to call X” — MCP closes the Expert loop when user gives URL + AC/request.

Human only: secrets when needed, release sign-off, confirm ambiguous money/permission TODOs.

---

## Phases

| Phase | What | Status |
|-------|------|--------|
| **P1** | `run_auto_qa` **auto-registers** regression suite + returns `suite_id` / `expert_checklist.suite_id_present` | done |
| **P2** | MCP `bootstrap_domain_pack` — write/update `domain-knowledge/` from request context (path = product root) | done |
| **P3** | `run_auto_qa` optional hooks: `role_b` → role compare; `openapi`/`openapi_path` → API cases in suite; `include_workflow_journeys` → journey cases in suite | done |
| **P4** | Single `run_expert_qa` facade (optional) wrapping discover→domain→auto_qa→suite→checklist | later |
| **P5** | Flake taxonomy in report + learning hints always in output | later |

## Non-goals

- Replace human release accountability  
- Full product E2E of every screen without AC  
- Pen-test / load platform  

## Success metric

One `:test` / `:dev` call with URL+AC → MCP returns gate + gaps + checklist + **suite_id** + domain pack path, without requiring a second “please register suite / copy template” step.

## Host loop (current)

```
bootstrap_domain_pack(product_root, request_context)
→ run_auto_qa(url, AC, [role_b|openapi|journeys])
→ honor expert_checklist + auto_registered_suite.suite_id
→ after fix: run_regression_suite(targeted)
```
