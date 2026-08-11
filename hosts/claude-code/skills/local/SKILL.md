---
name: local
description: >
  Expert QA against localhost. Derive AC from source when possible, run
  qa-intelligence MCP with the same Expert Tester gates as staging/tester.
  Trigger: "/qa-intelligence:local", "test this screen locally",
  "QA localhost", "kiểm tra local trước khi push".
---

# QA Intelligence — Local (Expert Tester)

**Role:** Developer self-QA on loopback.  
**Same process as tester.** Only difference: AC may come from **source code**; URL is localhost.

**MUST follow** `hosts/references/expert-tester-workflow.md` gates **G0→G8**.

MCP: `qa-intelligence`. Prefer `run_auto_qa` / `run_regression_suite` — never `execute_browser_test` on real UI.

---

## Local-specific G0–G1

1. Confirm target is `localhost` / `127.0.0.1` (loopback — env register optional).
2. Read the screen source in the workspace — do not invent AC not in code/comments.
3. Derive AC: required/optional, validation, `expected_text`, accessible names as UI exposes them.
4. If submit hits API: add `expected_network` on AC (`url_includes` + status/body).
5. `register_requirement` with derived AC; keep `requirement_ref`.
6. Secrets: `register_workspace_secret` if login needed — then `password_secret_ref`.

## Local G2–G4

- Discover: `discover_ui_surface` (or workflow if multi-route).
- If accessible names ≠ code labels → **fix source or AC before claiming pass**.
- Prefer Strategy A (`run_auto_qa`) with `output_path` under `docs/qa-reports/dev/`.
- If suite exists for this screen → Strategy B first.
- API in repo OpenAPI → `generate_api_smoke_from_openapi` + `execute_api_smoke` on local base URL.

## Local G5–G8 (identical to Expert)

1. State `release_recommendation` first.
2. Paste `coverage_gaps` + scope limits.
3. Follow `smart_retest_suggestion` after any fix — subset only.
4. Do **not** claim production readiness from localhost alone.
5. On fail: open `.qa-traces/*.zip` via `npx playwright show-trace`.

## Output

Use the **Output contract** in `hosts/references/expert-tester-workflow.md` with `Environment: local`.
