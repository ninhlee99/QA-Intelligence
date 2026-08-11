# What you do vs what the agent does

## You (product owner / QA lead) — required for Expert on *your* app

1. **Domain pack** — copy once per product:
   ```sh
   cp -R hosts/templates/domain-knowledge /path/to/your-app/domain-knowledge
   ```
   Fill `money` / `permission` / `business` risks. Without this = AC-only, not business Expert.

2. **Dogfood** — run `:test` / `:dev` on a real URL; confirm agent:
   - quotes `expert_checklist.claim_pass_allowed`
   - does not green-wash when false
   - registers suite + targeted retest works

3. **Secrets / staging URL** — you supply; agent must not invent.

4. **Release sign-off** — still human.

## Agent / repo (already in flight)

- Skills Expert bar + G0–G8  
- MCP `coverage_gaps`, `smart_retest_suggestion`, `expert_checklist`  
- Traces, regression subset, role/API mandates in workflow  

## Still later (engine depth — optional next)

- Richer multi-role authz matrix automation  
- Tighter flake taxonomy in report  
- npm-publish MCP for 1-click plugin install  
