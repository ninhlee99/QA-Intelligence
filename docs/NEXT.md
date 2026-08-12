# What you do vs what the agent does

## You (minimal)

1. Ask for test: `/qa-intelligence:test` or `:dev` + **URL** (+ spec or open source).  
2. Confirm only if agent asks a short question on money/permission ambiguity.  
3. **Release sign-off** stays human. Supply secrets when needed.

## Agent (automatic on each test request)

1. Bootstrap or update `domain-knowledge/` in the **product workspace** from templates + this request (no manual `cp`).  
2. G0 learning hints, discover, execute via MCP.  
3. Honor `expert_checklist.claim_pass_allowed` — no green-wash.  
4. Register suite + targeted retest plan.

## Optional later (engine)

- Deeper authz matrix, flake taxonomy, npm-publish MCP  

## Maturity KPI v1 (tracking)

Track per suite/release window:

1. `claim_pass_allowed_rate`
2. `blocked_by_oracle_rate`
3. `flake_rate_by_suite`
4. `drift_block_rate`
5. `gap_closure_lead_time`

Interpretation baseline:

- High `blocked_by_oracle_rate` -> AC quality issue; improve G2/G3 rewrite discipline.
- High `flake_rate_by_suite` -> stabilize selectors/waits before expanding coverage.
- High `drift_block_rate` -> UI change governance weak; tighten baseline ownership.
