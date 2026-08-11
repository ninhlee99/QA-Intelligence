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
