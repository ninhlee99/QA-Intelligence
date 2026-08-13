# QA Intelligence — Install & Usage Guide (detailed)

> **Product scope:** Skill + MCP serve **test** and **report** only.  
> No SNS / Slack / email notify / chatOps integration.  
> Defect export only produces text for the tester to paste into a tracker manually — it does not replace a ticket system.

This document is the **full operational guide**. Expert discipline workflow:  
[`hosts/references/expert-tester-workflow.md`](../hosts/references/expert-tester-workflow.md).  
Short tool catalog: [`hosts/README.md`](../hosts/README.md).

---

## Table of contents

1. [What the product is](#1-what-the-product-is)
2. [Quick architecture](#2-quick-architecture)
3. [System requirements](#3-system-requirements)
4. [Install the repo (one-time)](#4-install-the-repo-one-time)
5. [Install the MCP](#5-install-the-mcp)
6. [Install the Skill](#6-install-the-skill)
7. [Verify the install](#7-verify-the-install)
8. [How to use the Skill](#8-how-to-use-the-skill)
9. [How to use MCP & tools](#9-how-to-use-mcp--tools)
10. [Expert output — how to read it](#10-expert-output--how-to-read-it)
11. [End-to-end usage scenarios](#11-end-to-end-usage-scenarios)
12. [Secrets, environments, domain pack](#12-secrets-environments-domain-pack)
13. [Files/artifacts on disk](#13-filesartifacts-on-disk)
14. [Troubleshooting](#14-troubleshooting)
15. [Reference](#15-reference)

---

## 1. What the product is

**QA Intelligence** = an MCP server acting as an **Expert QA Engineer** inside Claude Code / Cursor / Codex.

You give it a **live URL** + **acceptance criteria (AC)**. The system:

1. Discovers the UI (Semantic UI Map)
2. Generates risk-based tests (positive / negative / boundary / adversarial)
3. Runs them for real with Playwright (+ flake detection)
4. Drafts defects with evidence (never fabricates `confirmed_cause`)
5. Returns a **release gate** + **coverage_gaps** + a Senior-Expert-style **session report**

### Does / doesn't

| Does (test + report) | Doesn't |
|--------------------|--------|
| Discover, generate, execute, gate | SNS / Slack / email notify |
| Defect draft + HTML report | Replace human release sign-off |
| Regression suite + targeted retest | Full pen-test engagement |
| API smoke, journey, depth smoke | Load test / full WCAG certification |
| Domain pack + Expert judgment | Invent AC / invent a pass |

### The two Skill commands

| Trigger | Who uses it | Where AC comes from |
|---------|---------|----------------|
| `/qa-intelligence:test` | Tester | Spec / ticket / stated behavior |
| `/qa-intelligence:dev` | Developer | Prefers **source code**; falls back to ticket |
| `$testcase` | Test designer | Produces executable testcases, no browser run yet |
| `$qa` | QA | Reviews requirement/risk/strategy and designs coverage |
| `$qc` | QC | Runs a real browser, collects evidence, returns a verdict |
| `$exploratory` | Exploratory tester | Time-boxed charter with live observations |
| `$retest` | Regression tester | Picks the smallest safe retest scope |
| `$defect-triage` | Defect analyst | Classifies, deduplicates, and reviews defects |

Advanced browser workflow supports authored TestCase actions `upload`,
`download`, `hover`, `drag_to`, iframes via `frame_accessible_name`, and
popups via `switch_to_popup`. Upload refs only resolve under
`.qa-upload-artifacts/`; download evidence lives under `.qa-downloads/`.
Regression suites only reuse cookies/storage when `reuse_session: true` is
passed, and state is cleaned up afterward.

`semantic_recovery: true` lets a stale role be repaired only when the
accessible name has exactly one candidate. Recovery is kept in the execution
evidence; ambiguous cases still fail. Evidence retention supports
preview/purge by outcome TTL, legal hold, and allowed-root isolation; a real
purge always requires explicit confirmation.

**Environment** = the URL you pass (localhost → local; any other URL →
staging hygiene). There is no separate "local/staging" Skill.

---

## 2. Quick architecture

```text
You
  └─ Host (Claude Code / Cursor / Codex)
       ├─ Skill  (:test / :dev)     ← Expert discipline (G0–G8), no engine inside
       └─ MCP    (qa-intelligence)  ← evidence engine (the real tools)
            └─ Playwright / HTTP / disk artifacts
```

- **Skill** = process: what to ask, which tool to call, forbids green-washing, report format.  
- **MCP** = execution: discover, run the browser, generate the JSON/HTML report.  
- The host **never** invents a pass on its own — it must rely on MCP evidence.

---

## 3. System requirements

| Component | Requirement |
|------------|---------|
| Node.js | `>=24 <25` (see `.nvmrc` → `24`) |
| npm | Ships with Node |
| OS | macOS / Linux / Windows (WSL recommended on Windows) |
| Playwright browser | Installed after `npm install` (see below) |
| AI host | Claude Code **or** Cursor **or** Codex |

Check Node:

```sh
node -v   # should print v24.x
npm -v
```

---

## 4. Install the repo (one-time)

```sh
git clone https://github.com/ninhlee99/QA-Intelligence.git
cd QA-Intelligence
npm install
npx playwright install chromium   # minimum; add firefox/webkit if needed
npm run build
```

Confirm the build:

```sh
ls dist/src/mcp/stdio-entrypoint.js
npm run typecheck
# full optional check:
npm test
```

Register the production command after building: `npm install --global .`.
Hosts invoke `qa-intelligence-mcp` and don't depend on the repository's
absolute path.

---

## 5. Install the MCP

MCP server command (stdio, used day-to-day):

```text
qa-intelligence-mcp
```

Commonly used environment variables:

| Env | Meaning | Example |
|-----|---------|--------|
| `QA_INTELLIGENCE_WORKSPACE_ID` | Required; safe workspace identifier | `billing-web` |
| `QA_INTELLIGENCE_DATA_DIR` | Optional absolute data root; defaults to XDG state outside the repo | `/srv/qa-intelligence/billing-web` |
| `QA_INTELLIGENCE_TOOL_PROFILE` | `expert` by default; `full` for specialist use | `expert` |
| `QA_INTELLIGENCE_DEADLINE_SECONDS` | Deadline 1–3600 seconds | `180` |
| `QA_INTELLIGENCE_HEADED` | `1`/`true` → Playwright opens a real (headed) browser window. Headless by default. | `1` |

### 5.1 Cursor

1. Open Cursor Settings → **MCP** (or edit Cursor's MCP config file).
2. Copy the template [`hosts/cursor/mcp.json.example`](../hosts/cursor/mcp.json.example).
3. Choose a workspace id specific to the project:

```json
{
  "mcpServers": {
    "qa-intelligence": {
      "command": "qa-intelligence-mcp",
      "env": {
        "QA_INTELLIGENCE_WORKSPACE_ID": "billing-web",
        "QA_INTELLIGENCE_TOOL_PROFILE": "expert",
        "QA_INTELLIGENCE_HEADED": "1"
      }
    }
  }
}
```

4. **Restart Cursor**.
5. Verify: ask the chat "list MCP tools qa-intelligence" or check Output → MCP.

**Common Cursor issues**

| Symptom | Fix |
|------------|-----------|
| Tools don't show up | Check `qa-intelligence-mcp` is on `PATH`; restart |
| `Cannot find module` | Re-run `npm run build` |
| Wrong Node version | Use Node 24 (`nvm use` / `fnm use`) |

### 5.2 Claude Code

**Option A — Plugin (recommended):**

```sh
cd /path/to/QA-Intelligence
claude plugin install ./hosts/claude-code
```

The plugin ships the Skills too. MCP still needs to point at the entrypoint
(via plugin config / `.mcp.json`).

**Option B — Manual MCP** in `.mcp.json` (project) or `~/.claude.json`:

```json
{
  "mcpServers": {
    "qa-intelligence": {
      "command": "qa-intelligence-mcp",
      "env": {
        "QA_INTELLIGENCE_WORKSPACE_ID": "billing-web",
        "QA_INTELLIGENCE_TOOL_PROFILE": "expert"
      }
    }
  }
}
```

Restart the Claude Code session after editing.

### 5.3 Codex

Install the plugin from `hosts/codex/` **or** add to `~/.codex/config.yaml`:

```yaml
mcpServers:
  qa-intelligence:
    command: qa-intelligence-mcp
    env:
      QA_INTELLIGENCE_WORKSPACE_ID: billing-web
      QA_INTELLIGENCE_TOOL_PROFILE: expert
```

### 5.4 Antigravity

Copy [`hosts/antigravity/mcp_config.json.example`](../hosts/antigravity/mcp_config.json.example)
into the workspace's `.agents/mcp_config.json`. Import whichever skill you
need from `hosts/codex/skills/`; the skills use the shared `SKILL.md`
standard and have no Codex-specific logic.

### 5.5 Remote MCP transport

The remote runtime supports:

- Streamable HTTP at `POST /mcp` — the default choice for new clients.
- Compatible SSE at `GET /sse` with the `POST /messages` endpoint the server advertises.

Every request needs a bearer token; SSE sessions are locked to a
workspace and actor. When deploying over a network, put the server behind a
reviewed HTTPS reverse proxy/load balancer. The server refuses to bind
non-loopback by default.

### 5.6 Remote MCP demo — not for production

Only when you need to share a process (not required for solo use):

```sh
cd /path/to/QA-Intelligence
npm run build
npm run mcp:remote:demo
```

- Default listen address: `http://127.0.0.1:8787/mcp`
- Demo token is **printed to stderr** at startup (only valid for verifying against that process)
- Override: `QA_INTELLIGENCE_DEV_REMOTE_HOST`, `QA_INTELLIGENCE_DEV_REMOTE_PORT`

Cursor remote sample: [`hosts/cursor/mcp-remote.json.example`](../hosts/cursor/mcp-remote.json.example)

```json
{
  "mcpServers": {
    "qa-intelligence-remote": {
      "url": "http://127.0.0.1:8787/mcp",
      "headers": {
        "Authorization": "Bearer <token-from-stderr>"
      }
    }
  }
}
```

Claude Code:

```sh
claude mcp add --transport http qa-intelligence-remote http://127.0.0.1:8787/mcp \
  --header "Authorization: Bearer <token>"
```

> The dev token **cannot** be reused after the server restarts.

### 5.7 Current auth status

| Mode | Auth | Notes |
|------|------|---------|
| Stdio | Fixture verifier | Dev — no IdP login required |
| Remote | Self-minted OIDC | Dev — token printed to stderr |
| Production IdP | Not shipped yet | ADR-014 |

---

## 6. Install the Skill

The Skill **does not** replace the MCP. The Skill only forces the agent to
follow the Expert workflow.

### 6.1 Claude Code

After `claude plugin install ./hosts/claude-code`, the Skills live in the plugin:

```text
hosts/claude-code/skills/test/SKILL.md
hosts/claude-code/skills/dev/SKILL.md
```

Trigger:

- `/qa-intelligence:test`
- `/qa-intelligence:dev`

Canonical workflow (required reading when using the Skill):

```text
hosts/references/expert-tester-workflow.md
hosts/references/domain-pack.md
```

### 6.2 Cursor

Sample Skills:

```text
hosts/cursor/skills/test/SKILL.md
hosts/cursor/skills/dev/SKILL.md
```

Attaching to Cursor (depends on Cursor version):

1. Copy the Skill content into the workspace's **Project Rules / Skills**, **or**
2. Point Cursor Agent Skills at the `hosts/cursor/skills/` directory, **or**
3. `@`-mention / paste the workflow at the start of a session

The Cursor Skill is **condensed** — full detail lives in:

- `hosts/references/expert-tester-workflow.md`
- `hosts/claude-code/skills/test/SKILL.md` (canonical, long form)

The Cursor MCP is still **required** (section 5.1). No MCP = no evidence.

### 6.3 Codex

```text
hosts/codex/skills/test/SKILL.md
hosts/codex/skills/dev/SKILL.md
```

Install via the `hosts/codex/` plugin or register the Skill per Codex docs.
Always connect the MCP as in section 5.3.

### 6.4 Skill-ready checklist

- [ ] MCP `qa-intelligence` shows up in the host
- [ ] Can call the `run_expert_qa` tool
- [ ] Skill `:test` / `:dev` shows up, or the agent has received the workflow instructions
- [ ] Agent knows **not** to say pass without `validate_expert_claim`

---

## 7. Verify the install

In the host chat:

1. **Ping MCP** — ask the agent to call `list_workspace_environments` (or any lightweight tool).  
   → A JSON response = MCP is alive.

2. **Expert smoke test (public or local URL):**

```text
Call `run_expert_qa` with:
  url: https://example.com
  acceptance_criteria: [
    { id: "ac-1", statement: "Page shows Example Domain heading", expected_text: "Example Domain" }
  ]
  acknowledge_domain_pack_absent: true
  execute_extension_cases: false
```

→ Expect `release_recommendation`, `coverage_gaps`, `expert_checklist`.

3. **Validate a claim:**

```text
validate_expert_claim({
  proposed_claim: "ready to ship",
  expert_checklist: <checklist from step 2>
})
```

→ Usually `allowed: false` (correct — this is the anti-green-wash gate).

---

## 8. How to use the Skill

### 8.1 `/qa-intelligence:test` (Tester)

**When:** You have a URL + spec/ticket/AC to verify.

**What the agent must do (G0→G8 summary):**

| Gate | Action |
|------|------|
| G0 | 5 risk questions + `list_failure_avoidance_hints` (+ learning candidates) |
| G0d | Domain pack: prefer `run_expert_qa(product_root)` |
| G1 | Env from URL; secrets via `*_secret_ref` |
| G2 | Live discovery via MCP |
| G3 | Bind AC — never invent AC |
| G4 | `run_expert_qa` (+ E2 hooks if a smell is present) |
| G5 | **First line of the result** = `release_recommendation` |
| G6 | Paste `coverage_gaps` + domain risks |
| G7 | suite_id, defects, traces, HTML |
| G8 | `smart_retest_suggestion` |
| Finally | Paste `expert_session_report.markdown` |
| Before saying pass | `validate_expert_claim` |

**Example prompt:**

```text
/qa-intelligence:test
URL: https://staging.example.com/orders
AC:
- ac-1: User sees order list titled "Orders" (expected_text: Orders)
- ac-2: Create order posts to /api/orders (expected_network: {url_includes:"/api/orders", method:"POST", status:201})
Login: use secret workspace-secret:staging-password
product_root: /Users/you/my-app
```

### 8.2 `/qa-intelligence:dev` (Developer)

**When:** Before pushing; AC is inferred from the code/diff currently open.

The agent prefers reading source → extracting observable AC →
`run_expert_qa` against localhost or a staging URL. **Same Expert bar** as
`:test` (the gate cannot be loosened).

### 8.3 Hard refuses (forbidden by the Skill)

The agent **must not** say ready / ship / pass / all good unless:

1. `expert_checklist.claim_pass_allowed === true`
2. `validate_expert_claim` → `allowed: true` for the **exact** sentence about to be said
3. `release_recommendation` from the MCP has been quoted
4. `coverage_gaps` has been stated
5. There's a retest plan following `smart_retest_suggestion`
6. Domain pack is OK (or its absence acknowledged — **still not a pass**)
7. E2 smells have been exercised or are listed among the blockers

Detail: [`RULES.md`](../RULES.md).

---

## 9. How to use MCP & tools

### 9.1 Tool-calling principles

1. **Evidence only** — conclusions must be based on MCP output.  
2. **Oracle on the AC** — every AC should have ≥1 of: `expected_text` | `expected_url_includes` | `expected_title_includes` | `expected_network`.  
3. **Secrets** — `register_workspace_secret` then use `password_secret_ref` / `bearer_token_secret_ref`. Never put a plaintext password into tool input.  
4. **Non-localhost** — `register_workspace_environment` before logging in / writing.  
5. **Narrow retest** — after a fix, use `run_regression_suite` + `case_ids` / `related_defect_ids` instead of burning the full suite.

### 9.2 Core tools (used daily)

#### `run_expert_qa` — **preferred Expert entry point**

This is the single public full pipeline: bootstraps the domain pack if
`product_root` is given, then discovers, designs, executes, gathers
evidence, and reports.

**Main input:**

| Field | Required | Description |
|-------|----------|--------|
| `url` | ✅ | Target (post-login screen if `login_*` is set) |
| `acceptance_criteria` | ✅ | Array of AC with id + statement + oracle |
| `product_root` | recommended | Absolute app path → domain-knowledge/ |
| `login_*` | if session-gated | Set of 6 login fields (all or none) |
| `role_b` | for multi-role | Second role to compare |
| `openapi` / `openapi_path` | for API | OpenAPI 3 |
| `include_authz_negatives` | for API | `true` to include unauth cases |
| `include_workflow_journeys` | for multi-page | `true` |
| `execute_extension_cases` | optional | Default true — runs capped API/journey in the same pass |
| `api_base_url` | optional | API origin if different from the UI url |
| `include_depth_smokes` | optional | Force depth smoke on/off |
| `stateful_lifecycle_documented` | optional | Confirms create→use→cleanup is documented |
| `risk_waives` | optional | `[{risk_id, reason_code, rationale}]` |
| `domain_high_risk_confirmed` | optional | After a human confirms a money/permission stub |
| `acknowledge_domain_pack_absent` | optional | Acknowledges a missing pack (still not a pass) |
| `output_path` | optional | Writes the HTML report (inside the output dir) |
| `browser` | optional | `chromium` \| `firefox` \| `webkit` |

**Important output:** see [section 10](#10-expert-output--how-to-read-it).

#### `validate_expert_claim`

```text
proposed_claim: the exact sentence about to be said to the user
expert_checklist: the object from the run just completed
```

→ `allowed` true/false + `refuse_reason` + `host_must`.

#### `run_regression_suite`

After a fix:

```text
suite_id: <from auto_registered_suite>
case_ids: [...]            # or
related_defect_ids: ["DEF-DRAFT:..."]
```

#### `bootstrap_domain_pack`

```text
product_root: /abs/path/to/app
request_context: "URL + AC text..."
pack_dirname: domain-knowledge   # or .qa-domain
```

### 9.3 Discovery

| Tool | When to use |
|------|----------|
| `discover_ui_surface` | Map 1 page (no login) |
| `discover_ui_surface_after_login` | Map after semantic login |
| `discover_ui_workflow` | Multi-page + edges |
| `discover_and_compare_role_ui_surfaces` | Compare 2 roles (authz UI) |
| `compare_ui_surfaces` | Diff 2 manual captures |

### 9.4 Standalone design & execution

| Tool | When to use |
|------|----------|
| `generate_test_cases` | Generate cases from AC + UI map (not the full pipeline) |
| `execute_generated_test_case` | Run 1 case |
| `generate_journey_test_cases` | Journeys from a workflow |
| `generate_exploratory_charter` | Exploratory charter |
| `execute_exploratory_session` | Bounded live probe |
| `run_depth_smokes` | a11y subset + perf + security heuristics |

> `execute_browser_test` = **DEMO ONLY** (seeds TC-DEMO). For a real full target use `run_expert_qa`; to run one already-designed case use `execute_generated_test_case`.

### 9.5 API

| Tool | When to use |
|------|----------|
| `generate_api_smoke_from_openapi` | OpenAPI → cases (+ authz negatives) |
| `execute_api_smoke` | Run the HTTP smoke |

In an Expert pass, prefer attaching OpenAPI to `run_expert_qa`
(`openapi` + `include_authz_negatives: true`) so it executes capped
**in the same pass**.

### 9.6 Defect & secondary reporting

| Tool | When to use |
|------|----------|
| `draft_defects_from_qa_run` | Re-draft from failed/flaky test_cases |
| `assess_defect_quality` | Review the quality of a draft |
| `export_defects_for_tracker` | Markdown/Jira **text** for the tester to paste manually |
| `assess_ui_accessibility_smoke` | Naming smoke (not full WCAG) |

> `file_defects_to_tracker` — optional dry-run; not an SNS. Does not POST by default unless `confirm_file=true`.

### 9.7 Baseline & learning (test/report)

| Tool | When to use |
|------|----------|
| `capture_ui_baseline` / `compare_ui_baseline` | PNG baseline |
| `register_ui_surface_baseline` / `compare_ui_surface_to_baseline` | Named-control drift |
| `list_failure_avoidance_hints` | G0 — hints to avoid past mistakes |
| `list_learning_candidates` | Learning candidates (not auto-promoted) |

### 9.8 Setup

| Tool | When to use |
|------|----------|
| `register_workspace_secret` / `list_workspace_secrets` | Secrets (list never returns the value) |
| `register_workspace_environment` / `list_workspace_environments` | Staging URL allowlist |
| `register_requirement` / `list_requirements` | Requirement ingestion |
| `register_test_dataset` / `resolve_test_dataset_fields` | Synthetic data |
| `register_regression_suite` / `list_regression_suites` | Manual suite (usually redundant if there's an auto suite) |

### 9.9 Document assessors / stubs

The `assess_*_quality` and `generate_*_stub` tools — support document review /
heuristic stubs. They **do not** replace the Expert execute gate.

Full catalog: [`hosts/README.md`](../hosts/README.md).

---

## 10. Expert output — how to read it

After `run_expert_qa`, read in **Senior order**:

### 10.1 Must read first

1. **`release_recommendation`** — the gate  
2. **`expert_checklist.claim_pass_allowed`** + **`blockers`**  
3. **`coverage_gaps`** — what wasn't tested  
4. **`expert_session_report.markdown`** — paste for the user (already has the Case results table)
5. **`smart_retest_suggestion`** — plan after a fix  

HTML: by default `report_html` is **not** embedded in the JSON (saves
tokens). Open the `report_path` file. Only set `include_report_html: true`
when debugging.

### 10.2 Additional Senior layer

| Field | Meaning |
|-------|---------|
| `expert_judgment` | Charter, oracle_strength, confidence (≤85), stopping, next exploratory |
| `expert_senior_hardening` | Domain enrich, role-diff, authz negatives, stateful, abuse residual, session delta |
| `expert_risk_matrix` | Impact × likelihood |
| `ac_quality_review` | Pushback on weak/missing-oracle AC |
| `git_blast_radius` | Retest suggestions from the diff (when `product_root` has `.git`) |
| `extension_execution` | Did API/journey run in the same pass? |
| `depth_smokes` | Depth results (if run) |
| `flake_taxonomy` | Flake classification |
| `learning` | Hints + candidates |
| `auto_registered_suite.suite_id` | For retesting |
| `draft_defects` | Fail/flaky → DEF-DRAFT (suspected only) |
| `report_path` | HTML on disk — **do not** dump `report_html` into chat |
| `report_html_omitted` / `report_html_bytes` | HTML was trimmed from the JSON; re-enable with `include_report_html` |

### 10.3 `release_recommendation` values

| Value | Short meaning |
|---------|----------------|
| `recommend_release` | Automation gate is green within scope — **still needs human sign-off** |
| `pass_with_gaps` | There are recorded gaps |
| `investigate_flakes` | There's a flake — don't ignore it |
| `changes_required` | There's a failure / something needs fixing |
| `do_not_release` | Critical/security-adjacent — do not release |

### 10.4 Before saying "pass" to a human

```text
validate_expert_claim({ proposed_claim, expert_checklist })
```

`allowed=false` → report **blocked/incomplete**, list the blockers. No
green-washing.

### 10.5 Wave 1 governance policy add-on

Before a pass claim, the following are also mandatory:

1. **Data readiness gate**: dataset/source, seed, cleanup/rollback, oracle mapping
2. **Flake decision**: `retry_once` | `quarantine_case` | `block_release`
3. **Drift decision** (if a baseline/surface compare exists): impact level + owner
4. **Oracle claimability**: AC with no `expected_*` => `not_claimable`

Missing any of the above => the only allowed conclusion is blocked/incomplete or a gap report.

---

## 11. End-to-end usage scenarios

### 11.1 Full feature test (tester)

```text
1. register_workspace_secret (password)
2. (staging) register_workspace_environment
3. run_expert_qa(
     product_root, url, acceptance_criteria,
     login_* + password_secret_ref,
     role_b?, openapi? + include_authz_negatives?,
     include_workflow_journeys?
   )
4. Read the gate + paste expert_session_report.markdown
5. validate_expert_claim before any pass/ship sentence
```

### 11.2 Retest after a fix

```text
1. Get suite_id + failed_case_ids / related_defect_ids from smart_retest_suggestion
2. run_regression_suite(...)
3. Read the new release_recommendation
4. If still failing: npx playwright show-trace .qa-traces/<file>.zip
```

### 11.3 API only

```text
generate_api_smoke_from_openapi({ openapi, include_authz_negatives: true })
→ execute_api_smoke({ base_url, cases, bearer_token_secret_ref? })
```

Or fold it into `run_expert_qa` with `openapi` + `api_base_url`.

### 11.4 No AC yet

```text
discover_ui_surface / discover_ui_surface_after_login
→ generate_exploratory_charter
→ execute_exploratory_session (optional)
→ draft AC with the PO
→ run_expert_qa
```

### 11.5 Multi-role

```text
run_expert_qa with login_* (role A) + role_b (role B)
```

Or the standalone tool `discover_and_compare_role_ui_surfaces`.  
If `only_in_a` / `only_in_b` is non-empty → triage or `risk_waives` with a rationale.

---

## 12. Secrets, environments, domain pack

### 12.1 Secrets

```text
register_workspace_secret({ name: "staging-password", value: "..." })
→ password_secret_ref: "workspace-secret:staging-password"
```

`list_workspace_secrets` only returns metadata — **never** the value.

### 12.2 Environment

For a non-loopback URL:

```text
register_workspace_environment({
  environment_ref: "environment:staging",
  base_url: "https://staging.example.com"
})
```

### 12.3 Domain pack

Templates: `hosts/templates/domain-knowledge/`.

```text
bootstrap_domain_pack / run_expert_qa(product_root=...)
```

Creates/updates `domain-knowledge/` (or `.qa-domain/`) inside the app.  
Money/permission stub → needs human confirmation, then
`domain_high_risk_confirmed=true`.  
Detail: [`hosts/references/domain-pack.md`](../hosts/references/domain-pack.md).

### 12.6 Data readiness checklist (before execute/passing)

- [ ] Dataset/source identified (ref or disclaimer)
- [ ] Seed strategy is clear for input data
- [ ] Cleanup/rollback strategy is clear
- [ ] Every AC has an observable oracle (`expected_*`)

Checklist fails => cannot claim a pass.

### 12.4 Structured waive (never silent)

```json
"risk_waives": [
  {
    "risk_id": "risk-stateful-data",
    "reason_code": "stateful_lifecycle_accepted",
    "rationale": "Ephemeral demo env — no durable fixtures this sprint."
  }
]
```

`rationale` ≥ 12 characters. Can clear a blocker matching `risk_id`.

### 12.5 Stateful lifecycle

- `stateful_lifecycle_documented: true` **or**
- waive `risk_id: risk-stateful-data`

---

## 13. Files/artifacts on disk

Survive across MCP restarts (usually under the process cwd):

| Directory | Content |
|---------|----------|
| `.qa-traces/` | Playwright fail traces → `npx playwright show-trace <file>.zip` |
| `.qa-screenshots/` | Failure images |
| `.qa-baselines/` | PNG baseline |
| `.qa-surface-baselines/` | Surface baseline |
| `.qa-regression-suites/` | Persisted suites |
| `.qa-avoidance-hints/` | Durable failure-avoidance hints |
| `.qa-learning-candidates/` | Learning candidates |
| `.qa-credentials/` | Credential registry |
| `.qa-test-datasets/` | Dataset registry |
| `.qa-knowledge/` | Knowledge records |
| `domain-knowledge/` | Inside **product_root** (the app), not the QA-Intelligence repo |

---

## 14. Troubleshooting

| Symptom | Common cause | Fix |
|-------------|-------------------|---------|
| MCP tools don't show up | Wrong path / not built / not restarted | Absolute path + `npm run build` + restart host |
| `authorization_denied` | Skill/agent version doesn't match the fixture | Use the correct repo's entrypoint; don't invent an agent id |
| Login fails | Missing one of the 6 login fields / wrong accessible_name | Discover the login page first; use the correct name |
| Lots of `not_executed` | AC missing an oracle / not bound to the UI | Add expected_*; check `ac_quality_review` |
| `claim_pass_allowed=false` | Correct behavior | Read `blockers`; don't green-wash |
| Flaky | Timing/network | `flake_taxonomy` + targeted retest |
| Flaky repeats in the same causal class | Test genuinely lacks stability | `quarantine_case`, assign a remediation owner, don't pass if it touches a critical path |
| Staging is blocked | Environment not registered | `register_workspace_environment` |
| UI drift between runs | Baseline/surface differs | Compare baseline/surface, classify severity, block if it affects a critical control |
| Depth/API is slow | Normal | `execute_extension_cases=false` / `include_depth_smokes=false` for narrow debugging |
| Node engine error | Node ≠ 24 | `nvm install 24 && nvm use 24` |

---

## 15. Reference

| Document | Content |
|----------|----------|
| [`PRODUCT.md`](PRODUCT.md) | One-page idea |
| [`../RULES.md`](../RULES.md) | Non-negotiables |
| [`../hosts/README.md`](../hosts/README.md) | Tool catalog + durable dirs |
| [`../hosts/references/expert-tester-workflow.md`](../hosts/references/expert-tester-workflow.md) | G0–G8 Expert bar |
| [`../hosts/references/domain-pack.md`](../hosts/references/domain-pack.md) | Domain pack |
| [`../hosts/claude-code/skills/test/SKILL.md`](../hosts/claude-code/skills/test/SKILL.md) | Canonical tester Skill |
| [`../hosts/claude-code/skills/dev/SKILL.md`](../hosts/claude-code/skills/dev/SKILL.md) | Dev Skill |
| [`plans/senior-expert-ceiling.md`](plans/senior-expert-ceiling.md) | Competency ceiling |
| [`NEXT.md`](NEXT.md) | Human work vs agent work |

---

## 60-second summary

```text
npm install && npx playwright install chromium && npm run build
→ Install the `qa-intelligence-mcp` command and configure a workspace id
→ Install the :test / :dev Skill for your host
→ /qa-intelligence:test + URL + AC (+ product_root)
→ Read release_recommendation + paste expert_session_report.markdown
→ validate_expert_claim before any pass/ship sentence
→ After a fix: run_regression_suite following smart_retest_suggestion
```

**Skill = discipline. MCP = evidence. Scope = test + report.**
