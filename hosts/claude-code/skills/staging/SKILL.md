---
name: staging
description: >
  Expert QA against staging (or any non-loopback shared env). Same Expert
  Tester gates as local/tester; stricter environment and secret hygiene.
  Trigger: "/qa-intelligence:staging", "QA staging", "test on staging",
  "kiểm tra staging".
---

# QA Intelligence — Staging (Expert Tester)

**Role:** Dev or QA validating a shared staging/preprod target.  
**Same Expert process.** Extra: allowlisted environment + explicit confirm before login.

**MUST follow** `hosts/references/expert-tester-workflow.md` gates **G0→G8**.

---

## Staging-specific G0–G1

1. Collect: staging URL, env name, AC/spec (ticket or prior requirement_ref), roles if any.
2. **Confirm target** with the user before any login that writes state.
3. `register_workspace_environment` (`environment_ref` + `base_url`) — required for non-loopback.
4. `register_workspace_secret` for passwords/tokens — only `*_secret_ref` afterward.
5. Prefer reusing `list_requirements` / prior `suite_id` when AC unchanged.

## Staging G2–G4

- Prefer Strategy B if regression suite exists for this feature.
- Strategy A (`run_auto_qa`) when AC/UI changed or first staging run.
- Role-sensitive change → `discover_and_compare_role_ui_surfaces` (mandatory when two roles matter).
- API: OpenAPI smoke with `include_authz_negatives: true` when routes are protected.
- Optional: `compare_ui_baseline` vs prior staging/local baseline (observation only).

## Staging G5–G8

1. Gate first — staging green ≠ production claim unless scope said so.
2. Surface authz gaps as residual risk.
3. Export serious drafts via `export_defects_for_tracker`; read `quality_warnings`.
4. Retest with `related_defect_ids` / `case_ids` only.

## Output

Use Output contract with `Environment: staging` (or named env).
