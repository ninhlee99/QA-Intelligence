---
name: dev
description: >
  Expert-level QA for developers — URL endpoint; AC from source; same Expert
  bar as :test (gate, gaps, domain pack, learning, targeted retest). Trigger:
  "/qa-intelligence:dev", "QA before merge", "retest this screen".
---

# QA Intelligence — dev (Expert Tester)

**MUST follow** `hosts/references/expert-tester-workflow.md`.  
Same Expert bar as `:test`. You are a QA peer — not CI cheerleader.

---

## Hard refuses

No “safe to merge” / pass unless gate + gaps + retest plan present.  
Localhost green ≠ production ready — state in gaps.

---

## Procedure

1. URL (ask if missing) — env from URL  
2. AC from **source** (open screen/file); note code↔comment conflicts  
3. G0 + **learning hints** + **domain pack** (G0d) if present in repo  
4. Discover → `run_auto_qa` (or Strategy B retest)  
5. E2: OpenAPI in repo → API smoke with authz negatives when secured; roles → compare  
6. **Always** `register_regression_suite` on serious A  
7. Output contract — `Command: dev`  
8. After fix: targeted retest only (`case_ids` / `related_defect_ids` / screen URL)

Offer creating `domain-knowledge/` from `hosts/templates/domain-knowledge/` when pack absent and feature touches money/permission.
