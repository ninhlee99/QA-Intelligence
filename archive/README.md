# Archive — governance baseline

Historical SPECs, ADRs, GOV docs, playbooks, and related indexes from the
earlier “governed knowledge platform” phase of this repository.

**Not required to run or extend the Expert QA MCP.**

Product path today:

- [`../docs/PRODUCT.md`](../docs/PRODUCT.md) — idea
- [`../RULES.md`](../RULES.md) — non-negotiables
- [`../docs/GUIDE.md`](../docs/GUIDE.md) — install & workflows
- [`../src/`](../src/) — implementation

To re-run the old repository validator (optional):

```sh
python3 archive/governance-baseline/validate_repository.py
# Note: paths inside the script still expect files at repo root.
# Prefer reading SPECs here for history only.
```

Kept at repo root because runtime still loads them:

- `ontology/` + `meta/ONTOLOGY_INDEX.yaml`
- `schemas/` + `examples/` (optional schema CI)
