---
name: defect-triage
description: >
  Turn observed failed or flaky test results into deduplicated, evidence-backed
  defect drafts and quality-check existing defects. Use for defect classification,
  severity/priority triage, reproducibility, impact, or tracker-ready export.
---

# Defect triage

1. Use `draft_defects_from_qa_run` for observed failed/flaky outcomes; do not draft defects from assumptions alone.
2. Deduplicate by behavior, surface, build/environment, and evidence—not title similarity alone.
3. Record expected vs actual, exact reproduction, scope, impact if shipped, severity, priority, environment, and evidence references.
4. Keep `confirmed_cause` empty until independently proven; use suspected cause with uncertainty when useful.
5. Run `assess_defect_quality` before export. Use tracker filing only when explicitly authorized; dry-run first.

Do not hide infrastructure failures as product defects or merge materially different causes into one defect.
