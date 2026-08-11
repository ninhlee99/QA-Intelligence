# QA Intelligence — Hướng dẫn cài đặt & sử dụng (chi tiết)

> **Phạm vi sản phẩm:** Skill + MCP chỉ phục vụ **test** và **report**.  
> Không có tích hợp SNS / Slack / email notify / chatOps.  
> Export defect chỉ tạo text để tester tự dán tracker — không thay ticket system.

Tài liệu này là **hướng dẫn vận hành đầy đủ**. Workflow kỷ luật Expert:  
[`hosts/references/expert-tester-workflow.md`](../hosts/references/expert-tester-workflow.md).  
Catalog tool ngắn: [`hosts/README.md`](../hosts/README.md).

---

## Mục lục

1. [Sản phẩm là gì](#1-sản-phẩm-là-gì)
2. [Kiến trúc nhanh](#2-kiến-trúc-nhanh)
3. [Yêu cầu hệ thống](#3-yêu-cầu-hệ-thống)
4. [Cài đặt repo (một lần)](#4-cài-đặt-repo-một-lần)
5. [Cài đặt MCP](#5-cài-đặt-mcp)
6. [Cài đặt Skill](#6-cài-đặt-skill)
7. [Kiểm tra cài đặt thành công](#7-kiểm-tra-cài-đặt-thành-công)
8. [Cách dùng Skill](#8-cách-dùng-skill)
9. [Cách dùng MCP & tool](#9-cách-dùng-mcp--tool)
10. [Output Expert — đọc thế nào](#10-output-expert--đọc-thế-nào)
11. [Kịch bản sử dụng end-to-end](#11-kịch-bản-sử-dụng-end-to-end)
12. [Bí mật, môi trường, domain pack](#12-bí-mật-môi-trường-domain-pack)
13. [File/artifact trên đĩa](#13-fileartifact-trên-đĩa)
14. [Troubleshooting](#14-troubleshooting)
15. [Tham chiếu](#15-tham-chiếu)

---

## 1. Sản phẩm là gì

**QA Intelligence** = MCP server đóng vai **Expert QA Engineer** bên trong Claude Code / Cursor / Codex.

Bạn đưa **URL sống** + **acceptance criteria (AC)**. Hệ thống:

1. Discover UI (Semantic UI Map)
2. Sinh test theo risk (positive / negative / boundary / adversarial)
3. Chạy thật bằng Playwright (+ flake detection)
4. Draft defect có evidence (không bịa `confirmed_cause`)
5. Trả **release gate** + **coverage_gaps** + **session report** kiểu Senior Expert

### Có / không

| Có (test + report) | Không |
|--------------------|--------|
| Discover, generate, execute, gate | SNS / Slack / email notify |
| Defect draft + HTML report | Thay người ký release |
| Regression suite + targeted retest | Pen-test engagement đầy đủ |
| API smoke, journey, depth smoke | Load test / full WCAG certification |
| Domain pack + Expert judgment | Invent AC / invent pass |

### Hai lệnh Skill duy nhất

| Trigger | Ai dùng | AC lấy từ đâu |
|---------|---------|----------------|
| `/qa-intelligence:test` | Tester | Spec / ticket / hành vi đã nêu |
| `/qa-intelligence:dev` | Developer | Ưu tiên **source code**; không có thì ticket |

**Môi trường** = URL bạn truyền (localhost → local; URL khác → staging hygiene). Không có Skill riêng “local/staging”.

---

## 2. Kiến trúc nhanh

```text
Bạn
  └─ Host (Claude Code / Cursor / Codex)
       ├─ Skill  (:test / :dev)     ← kỷ luật Expert (G0–G8), không chứa engine
       └─ MCP    (qa-intelligence)  ← evidence engine (tool thật)
            └─ Playwright / HTTP / disk artifacts
```

- **Skill** = quy trình: hỏi gì, gọi tool nào, cấm green-wash, format báo cáo.  
- **MCP** = thực thi: discover, chạy browser, sinh report JSON/HTML.  
- Host **không** tự bịa pass — phải dựa evidence MCP.

---

## 3. Yêu cầu hệ thống

| Thành phần | Yêu cầu |
|------------|---------|
| Node.js | `>=24 <25` (xem `.nvmrc` → `24`) |
| npm | Đi kèm Node |
| OS | macOS / Linux / Windows (WSL khuyến nghị trên Windows) |
| Trình duyệt Playwright | Cài sau `npm install` (xem bên dưới) |
| Host AI | Claude Code **hoặc** Cursor **hoặc** Codex |

Kiểm tra Node:

```sh
node -v   # phải ra v24.x
npm -v
```

---

## 4. Cài đặt repo (một lần)

```sh
git clone https://github.com/ninhlee99/QA-Intelligence.git
cd QA-Intelligence
npm install
npx playwright install chromium   # tối thiểu; thêm firefox/webkit nếu cần
npm run build
```

Xác nhận build:

```sh
ls dist/src/mcp/dev-entrypoint.js
npm run typecheck
# tùy chọn đầy đủ:
npm test
```

**Ghi nhớ đường dẫn tuyệt đối** tới repo, ví dụ:

```text
/Users/you/Documents/agents/QA-Intelligence
```

Cursor/Codex **bắt buộc absolute path** tới `dev-entrypoint.js`.

---

## 5. Cài đặt MCP

MCP server entrypoint (stdio, dùng hàng ngày):

```text
<REPO>/dist/src/mcp/dev-entrypoint.js
```

Biến môi trường thường dùng:

| Env | Ý nghĩa | Ví dụ |
|-----|---------|--------|
| `QA_INTELLIGENCE_DEV_WORKSPACE_ID` | Workspace id fixture | `workspace-cursor-dev` |

### 5.1 Cursor

1. Mở Cursor Settings → **MCP** (hoặc chỉnh file MCP config của Cursor).
2. Copy mẫu [`hosts/cursor/mcp.json.example`](../hosts/cursor/mcp.json.example).
3. Thay `/absolute/path/to/QA-Intelligence` bằng path thật:

```json
{
  "mcpServers": {
    "qa-intelligence": {
      "command": "node",
      "args": [
        "/Users/you/Documents/agents/QA-Intelligence/dist/src/mcp/dev-entrypoint.js"
      ],
      "env": {
        "QA_INTELLIGENCE_DEV_WORKSPACE_ID": "workspace-cursor-dev"
      }
    }
  }
}
```

4. **Restart Cursor**.
5. Kiểm tra: chat hỏi “list MCP tools qa-intelligence” hoặc xem Output → MCP.

**Lỗi thường gặp Cursor**

| Hiện tượng | Cách xử lý |
|------------|------------|
| Tools không hiện | Path relative → đổi absolute; restart |
| `Cannot find module` | Chạy lại `npm run build` |
| Node sai version | Dùng Node 24 (`nvm use` / `fnm use`) |

### 5.2 Claude Code

**Cách A — Plugin (khuyến nghị):**

```sh
cd /path/to/QA-Intelligence
claude plugin install ./hosts/claude-code
```

Plugin mang theo Skills. MCP vẫn cần trỏ tới entrypoint (qua cấu hình plugin / `.mcp.json`).

**Cách B — MCP thủ công** trong `.mcp.json` (project) hoặc `~/.claude.json`:

```json
{
  "mcpServers": {
    "qa-intelligence": {
      "command": "node",
      "args": [
        "/Users/you/Documents/agents/QA-Intelligence/dist/src/mcp/dev-entrypoint.js"
      ],
      "env": {
        "QA_INTELLIGENCE_DEV_WORKSPACE_ID": "workspace-claude-dev"
      }
    }
  }
}
```

Restart session Claude Code sau khi sửa.

### 5.3 Codex

Cài plugin từ `hosts/codex/` **hoặc** thêm vào `~/.codex/config.yaml`:

```yaml
mcpServers:
  qa-intelligence:
    command: node
    args:
      - /Users/you/Documents/agents/QA-Intelligence/dist/src/mcp/dev-entrypoint.js
    env:
      QA_INTELLIGENCE_DEV_WORKSPACE_ID: workspace-codex-dev
```

### 5.4 Remote MCP (team / máy khác) — tùy chọn

Chỉ khi cần share process (không bắt buộc cho solo):

```sh
cd /path/to/QA-Intelligence
npm run build
node dist/src/mcp/remote-dev-entrypoint.js
```

- Listen mặc định: `http://127.0.0.1:8787/mcp`
- Token demo **in ra stderr** lúc start (chỉ verify với process đó)
- Override: `QA_INTELLIGENCE_DEV_REMOTE_HOST`, `QA_INTELLIGENCE_DEV_REMOTE_PORT`

Cursor remote mẫu: [`hosts/cursor/mcp-remote.json.example`](../hosts/cursor/mcp-remote.json.example)

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

> Dev token **không** dùng lại sau restart server.

### 5.5 Trạng thái auth hiện tại

| Mode | Auth | Ghi chú |
|------|------|---------|
| Stdio | Fixture verifier | Dev — không cần login IdP |
| Remote | Self-minted OIDC | Dev — token in stderr |
| Production IdP | Chưa ship | ADR-014 |

---

## 6. Cài đặt Skill

Skill **không** thay MCP. Skill chỉ ép agent tuân Expert workflow.

### 6.1 Claude Code

Sau `claude plugin install ./hosts/claude-code`, Skills nằm trong plugin:

```text
hosts/claude-code/skills/test/SKILL.md
hosts/claude-code/skills/dev/SKILL.md
```

Trigger:

- `/qa-intelligence:test`
- `/qa-intelligence:dev`

Canonical workflow (bắt buộc đọc khi dùng Skill):

```text
hosts/references/expert-tester-workflow.md
hosts/references/domain-pack.md
```

### 6.2 Cursor

Skills mẫu:

```text
hosts/cursor/skills/test/SKILL.md
hosts/cursor/skills/dev/SKILL.md
```

Cách gắn vào Cursor (tùy phiên bản Cursor):

1. Copy nội dung Skill vào **Project Rules / Skills** của workspace, **hoặc**
2. Trỏ Cursor Agent Skills tới thư mục `hosts/cursor/skills/`, **hoặc**
3. `@`-mention / paste workflow khi bắt đầu session

Skill Cursor **rút gọn** — chi tiết nằm ở:

- `hosts/references/expert-tester-workflow.md`
- `hosts/claude-code/skills/test/SKILL.md` (canonical dài)

MCP Cursor vẫn **bắt buộc** (mục 5.1). Không có MCP = không có evidence.

### 6.3 Codex

```text
hosts/codex/skills/test/SKILL.md
hosts/codex/skills/dev/SKILL.md
```

Cài qua plugin `hosts/codex/` hoặc đăng ký Skill theo docs Codex. Luôn kết nối MCP như mục 5.3.

### 6.4 Checklist Skill đã sẵn sàng

- [ ] MCP `qa-intelligence` hiện trong host
- [ ] Gọi được tool `run_expert_qa` hoặc `run_auto_qa`
- [ ] Skill `:test` / `:dev` hiện hoặc agent nhận instruction workflow
- [ ] Agent biết **không** nói pass nếu chưa `validate_expert_claim`

---

## 7. Kiểm tra cài đặt thành công

Trong chat host:

1. **Ping MCP** — yêu cầu agent gọi `list_workspace_environments` (hoặc bất kỳ tool nhẹ).  
   → Có JSON response = MCP sống.

2. **Smoke Expert (URL public hoặc local):**

```text
Gọi run_auto_qa với:
  url: https://example.com
  acceptance_criteria: [
    { id: "ac-1", statement: "Page shows Example Domain heading", expected_text: "Example Domain" }
  ]
  acknowledge_domain_pack_absent: true
  execute_extension_cases: false
```

→ Nhận `release_recommendation`, `coverage_gaps`, `expert_checklist`.

3. **Validate claim:**

```text
validate_expert_claim({
  proposed_claim: "ready to ship",
  expert_checklist: <checklist từ bước 2>
})
```

→ Thường `allowed: false` (đúng — chống green-wash).

---

## 8. Cách dùng Skill

### 8.1 `/qa-intelligence:test` (Tester)

**Khi nào:** Có URL + spec/ticket/AC cần kiểm.

**Agent phải làm (G0→G8 tóm tắt):**

| Gate | Việc |
|------|------|
| G0 | 5 câu risk + `list_failure_avoidance_hints` (+ learning candidates) |
| G0d | Domain pack: ưu tiên `run_expert_qa(product_root)` |
| G1 | Env từ URL; secret qua `*_secret_ref` |
| G2 | Discover live qua MCP |
| G3 | Bind AC — không bịa AC |
| G4 | `run_expert_qa` hoặc `run_auto_qa` (+ E2 hooks nếu smell) |
| G5 | **Dòng đầu kết quả** = `release_recommendation` |
| G6 | Dán `coverage_gaps` + domain risks |
| G7 | suite_id, defects, traces, HTML |
| G8 | `smart_retest_suggestion` |
| Cuối | Paste `expert_session_report.markdown` |
| Trước câu pass | `validate_expert_claim` |

**Ví dụ prompt:**

```text
/qa-intelligence:test
URL: https://staging.example.com/orders
AC:
- ac-1: User sees order list titled "Orders" (expected_text: Orders)
- ac-2: Create order posts to /api/orders (expected_network: {url_includes:"/api/orders", method:"POST", status:201})
Login: dùng secret workspace-secret:staging-password
product_root: /Users/you/my-app
```

### 8.2 `/qa-intelligence:dev` (Developer)

**Khi nào:** Trước khi push; AC suy từ code/diff đang mở.

Agent ưu tiên đọc source → rút AC observable → `run_expert_qa` / `run_auto_qa` trên localhost hoặc staging URL. **Cùng Expert bar** với `:test` (không được nới lỏng gate).

### 8.3 Hard refuses (Skill cấm)

Agent **không được** nói ready / ship / pass / all good trừ khi:

1. `expert_checklist.claim_pass_allowed === true`
2. `validate_expert_claim` → `allowed: true` với **đúng** câu sẽ nói
3. Đã quote `release_recommendation` từ MCP
4. Đã nêu `coverage_gaps`
5. Có plan retest theo `smart_retest_suggestion`
6. Domain pack OK (hoặc absence acknowledged — **vẫn không pass**)
7. E2 smells đã exercise hoặc nằm trong blockers

Chi tiết: [`RULES.md`](../RULES.md).

---

## 9. Cách dùng MCP & tool

### 9.1 Nguyên tắc gọi tool

1. **Evidence only** — kết luận dựa output MCP.  
2. **Oracle trên AC** — mỗi AC nên có ≥1: `expected_text` | `expected_url_includes` | `expected_title_includes` | `expected_network`.  
3. **Secret** — `register_workspace_secret` rồi `password_secret_ref` / `bearer_token_secret_ref`. Không nhét password plain vào tool input.  
4. **Non-localhost** — `register_workspace_environment` trước khi login/ghi.  
5. **Retest hẹp** — sau fix dùng `run_regression_suite` + `case_ids` / `related_defect_ids`, không đốt full suite.

### 9.2 Tool lõi (dùng hàng ngày)

#### `run_expert_qa` — **entry Expert ưu tiên**

Bootstrap domain pack (nếu có `product_root`) + full `run_auto_qa`.

**Input chính:**

| Field | Bắt buộc | Mô tả |
|-------|----------|--------|
| `url` | ✅ | Target (post-login screen nếu có login_*) |
| `acceptance_criteria` | ✅ | Mảng AC có id + statement + oracle |
| `product_root` | khuyến nghị | Absolute path app → domain-knowledge/ |
| `login_*` | nếu session-gated | Bộ 6 field login (all or none) |
| `role_b` | khi multi-role | Role thứ 2 để compare |
| `openapi` / `openapi_path` | khi API | OpenAPI 3 |
| `include_authz_negatives` | khi API | `true` để có case unauth |
| `include_workflow_journeys` | khi multi-page | `true` |
| `execute_extension_cases` | optional | Default true — chạy capped API/journey cùng pass |
| `api_base_url` | optional | Origin API nếu khác UI url |
| `include_depth_smokes` | optional | Force on/off depth smoke |
| `stateful_lifecycle_documented` | optional | Xác nhận create→use→cleanup đã document |
| `risk_waives` | optional | `[{risk_id, reason_code, rationale}]` |
| `domain_high_risk_confirmed` | optional | Sau khi human confirm stub money/permission |
| `acknowledge_domain_pack_absent` | optional | Ghi nhận thiếu pack (vẫn không pass) |
| `output_path` | optional | Ghi HTML report (trong output dir) |
| `browser` | optional | `chromium` \| `firefox` \| `webkit` |

**Output quan trọng:** xem [mục 10](#10-output-expert--đọc-thế-nào).

#### `run_auto_qa`

Giống pipeline trên **không** bắt buộc facade bootstrap. Dùng khi đã có pack hoặc không cần `product_root` trong cùng call. Input gần như `run_expert_qa`.

#### `validate_expert_claim`

```text
proposed_claim: câu sẽ nói với user
expert_checklist: object từ run vừa rồi
```

→ `allowed` true/false + `refuse_reason` + `host_must`.

#### `run_regression_suite`

Sau fix:

```text
suite_id: <từ auto_registered_suite>
case_ids: [...]            # hoặc
related_defect_ids: ["DEF-DRAFT:..."]
```

#### `bootstrap_domain_pack`

```text
product_root: /abs/path/to/app
request_context: "URL + AC text..."
pack_dirname: domain-knowledge   # hoặc .qa-domain
```

### 9.3 Discovery

| Tool | Dùng khi |
|------|----------|
| `discover_ui_surface` | Map 1 trang (không login) |
| `discover_ui_surface_after_login` | Map sau login semantic |
| `discover_ui_workflow` | Multi-page + edges |
| `discover_and_compare_role_ui_surfaces` | So 2 role (authz UI) |
| `compare_ui_surfaces` | Diff 2 capture thủ công |

### 9.4 Design & execute lẻ

| Tool | Dùng khi |
|------|----------|
| `generate_test_cases` | Sinh case từ AC + UI map (không full pipeline) |
| `execute_generated_test_case` | Chạy 1 case |
| `generate_journey_test_cases` | Journey từ workflow |
| `generate_exploratory_charter` | Charter exploratory |
| `execute_exploratory_session` | Probe sống giới hạn |
| `run_depth_smokes` | a11y subset + perf + security heuristics |

> `execute_browser_test` = **DEMO ONLY** (seed TC-DEMO). Target thật → `run_auto_qa` / `execute_generated_test_case`.

### 9.5 API

| Tool | Dùng khi |
|------|----------|
| `generate_api_smoke_from_openapi` | OpenAPI → cases (+ authz negatives) |
| `execute_api_smoke` | Chạy HTTP smoke |

Trong Expert pass, ưu tiên gắn OpenAPI vào `run_auto_qa`/`run_expert_qa` (`openapi` + `include_authz_negatives: true`) để **cùng pass** execute capped.

### 9.6 Defect & report phụ

| Tool | Dùng khi |
|------|----------|
| `draft_defects_from_qa_run` | Tái draft từ test_cases fail/flaky |
| `assess_defect_quality` | Review chất lượng bản draft |
| `export_defects_for_tracker` | Markdown/Jira **text** để tester tự dán |
| `assess_ui_accessibility_smoke` | Naming smoke (không phải WCAG full) |

> `file_defects_to_tracker` — optional dry-run; không phải SNS. Mặc định không POST trừ `confirm_file=true`.

### 9.7 Baseline & learning (test/report)

| Tool | Dùng khi |
|------|----------|
| `capture_ui_baseline` / `compare_ui_baseline` | PNG baseline |
| `register_ui_surface_baseline` / `compare_ui_surface_to_baseline` | Drift named-control |
| `list_failure_avoidance_hints` | G0 — hint tránh lỗi cũ |
| `list_learning_candidates` | Ứng viên học (không auto-promote) |

### 9.8 Setup

| Tool | Dùng khi |
|------|----------|
| `register_workspace_secret` / `list_workspace_secrets` | Secret (list không trả value) |
| `register_workspace_environment` / `list_workspace_environments` | Allowlist URL staging |
| `register_requirement` / `list_requirements` | Ingest requirement |
| `register_test_dataset` / `resolve_test_dataset_fields` | Data synthetic |
| `register_regression_suite` / `list_regression_suites` | Suite thủ công (thường thừa nếu auto suite) |

### 9.9 Document assessors / stubs

Các `assess_*_quality` và `generate_*_stub` — hỗ trợ review tài liệu / stub heuristic. **Không** thay Expert execute gate.

Catalog đầy đủ: [`hosts/README.md`](../hosts/README.md).

---

## 10. Output Expert — đọc thế nào

Sau `run_expert_qa` / `run_auto_qa`, đọc **theo thứ tự Senior**:

### 10.1 Bắt buộc đọc trước

1. **`release_recommendation`** — gate  
2. **`expert_checklist.claim_pass_allowed`** + **`blockers`**  
3. **`coverage_gaps`** — những gì chưa test  
4. **`expert_session_report.markdown`** — paste cho user  
5. **`smart_retest_suggestion`** — plan sau fix  

### 10.2 Lớp Senior thêm

| Field | Ý nghĩa |
|-------|---------|
| `expert_judgment` | Charter, oracle_strength, confidence (≤85), stopping, next exploratory |
| `expert_senior_hardening` | Domain enrich, role-diff, authz negatives, stateful, abuse residual, session delta |
| `expert_risk_matrix` | Impact × likelihood |
| `ac_quality_review` | Pushback AC yếu/thiếu oracle |
| `git_blast_radius` | Gợi ý retest từ diff (khi `product_root` có `.git`) |
| `extension_execution` | API/journey đã chạy cùng pass? |
| `depth_smokes` | Kết quả depth (nếu chạy) |
| `flake_taxonomy` | Phân loại flake |
| `learning` | Hints + candidates |
| `auto_registered_suite.suite_id` | Để retest |
| `draft_defects` | Fail/flaky → DEF-DRAFT (suspected only) |
| `report_html` / `report_path` | Báo cáo HTML |

### 10.3 Giá trị `release_recommendation`

| Giá trị | Ý nghĩa ngắn |
|---------|----------------|
| `recommend_release` | Gate automation xanh trong scope — **vẫn cần human sign-off** |
| `pass_with_gaps` | Có khoảng trống đã ghi |
| `investigate_flakes` | Có flake — không bỏ qua |
| `changes_required` | Có fail / cần sửa |
| `do_not_release` | Critical/security-ish — không release |

### 10.4 Trước khi nói “pass” với người

```text
validate_expert_claim({ proposed_claim, expert_checklist })
```

`allowed=false` → báo **blocked/incomplete**, liệt kê blockers. Không green-wash.

---

## 11. Kịch bản sử dụng end-to-end

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
4. Đọc gate + paste expert_session_report.markdown
5. validate_expert_claim trước mọi câu pass/ship
```

### 11.2 Retest sau fix

```text
1. Lấy suite_id + failed_case_ids / related_defect_ids từ smart_retest_suggestion
2. run_regression_suite(...)
3. Đọc release_recommendation mới
4. Nếu còn fail: npx playwright show-trace .qa-traces/<file>.zip
```

### 11.3 Chỉ API

```text
generate_api_smoke_from_openapi({ openapi, include_authz_negatives: true })
→ execute_api_smoke({ base_url, cases, bearer_token_secret_ref? })
```

Hoặc gộp vào `run_expert_qa` với `openapi` + `api_base_url`.

### 11.4 Không có AC

```text
discover_ui_surface / discover_ui_surface_after_login
→ generate_exploratory_charter
→ execute_exploratory_session (optional)
→ soạn AC với PO
→ run_expert_qa
```

### 11.5 Multi-role

```text
run_auto_qa / run_expert_qa với login_* (role A) + role_b (role B)
```

Hoặc tool riêng `discover_and_compare_role_ui_surfaces`.  
Nếu `only_in_a` / `only_in_b` khác rỗng → triage hoặc `risk_waives` có rationale.

---

## 12. Bí mật, môi trường, domain pack

### 12.1 Secrets

```text
register_workspace_secret({ name: "staging-password", value: "..." })
→ password_secret_ref: "workspace-secret:staging-password"
```

`list_workspace_secrets` chỉ metadata — **không** trả lại value.

### 12.2 Environment

URL không phải loopback:

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

Tạo/cập nhật `domain-knowledge/` (hoặc `.qa-domain/`) trong app.  
Stub money/permission → cần human confirm rồi `domain_high_risk_confirmed=true`.  
Chi tiết: [`hosts/references/domain-pack.md`](../hosts/references/domain-pack.md).

### 12.4 Waive có cấu trúc (không silent)

```json
"risk_waives": [
  {
    "risk_id": "risk-stateful-data",
    "reason_code": "stateful_lifecycle_accepted",
    "rationale": "Ephemeral demo env — no durable fixtures this sprint."
  }
]
```

`rationale` ≥ 12 ký tự. Có thể clear blocker khớp `risk_id`.

### 12.5 Stateful lifecycle

- `stateful_lifecycle_documented: true` **hoặc**
- waive `risk_id: risk-stateful-data`

---

## 13. File/artifact trên đĩa

Sống qua restart MCP (thường dưới cwd process):

| Thư mục | Nội dung |
|---------|----------|
| `.qa-traces/` | Playwright fail traces → `npx playwright show-trace <file>.zip` |
| `.qa-screenshots/` | Ảnh fail |
| `.qa-baselines/` | PNG baseline |
| `.qa-surface-baselines/` | Surface baseline |
| `.qa-regression-suites/` | Suite đã persist |
| `.qa-avoidance-hints/` | Failure-avoidance durable |
| `.qa-learning-candidates/` | Learning candidates |
| `.qa-credentials/` | Credential registry |
| `.qa-test-datasets/` | Dataset registry |
| `.qa-knowledge/` | Knowledge records |
| `domain-knowledge/` | Trong **product_root** (app), không phải repo QA-Intelligence |

---

## 14. Troubleshooting

| Triệu chứng | Nguyên nhân thường | Cách xử |
|-------------|-------------------|---------|
| MCP không hiện tool | Path sai / chưa build / chưa restart | Absolute path + `npm run build` + restart host |
| `authorization_denied` | Skill/agent version không khớp fixture | Dùng entrypoint đúng repo; đừng tự bịa agent id |
| Login fail | Thiếu bộ login 6 field / sai accessible_name | Discover login page trước; dùng đúng name |
| Nhiều `not_executed` | AC thiếu oracle / không bind UI | Thêm expected_* ; xem `ac_quality_review` |
| `claim_pass_allowed=false` | Đúng hành vi | Đọc `blockers`; đừng green-wash |
| Flaky | Timing/network | `flake_taxonomy` + targeted retest |
| Staging bị chặn | Chưa register environment | `register_workspace_environment` |
| Depth/API chậm | Normal | `execute_extension_cases=false` / `include_depth_smokes=false` khi debug hẹp |
| Node engine error | Node ≠ 24 | `nvm install 24 && nvm use 24` |

---

## 15. Tham chiếu

| Tài liệu | Nội dung |
|----------|----------|
| [`PRODUCT.md`](PRODUCT.md) | Ý tưởng 1 trang |
| [`../RULES.md`](../RULES.md) | Non-negotiables |
| [`../hosts/README.md`](../hosts/README.md) | Catalog tool + durable dirs |
| [`../hosts/references/expert-tester-workflow.md`](../hosts/references/expert-tester-workflow.md) | G0–G8 Expert bar |
| [`../hosts/references/domain-pack.md`](../hosts/references/domain-pack.md) | Domain pack |
| [`../hosts/claude-code/skills/test/SKILL.md`](../hosts/claude-code/skills/test/SKILL.md) | Skill tester canonical |
| [`../hosts/claude-code/skills/dev/SKILL.md`](../hosts/claude-code/skills/dev/SKILL.md) | Skill dev |
| [`plans/senior-expert-ceiling.md`](plans/senior-expert-ceiling.md) | Competency ceiling |
| [`NEXT.md`](NEXT.md) | Việc người vs agent |

---

## Tóm tắt 60 giây

```text
npm install && npx playwright install chromium && npm run build
→ Cấu hình MCP (absolute path tới dist/src/mcp/dev-entrypoint.js)
→ Cài Skill :test / :dev theo host
→ /qa-intelligence:test + URL + AC (+ product_root)
→ Đọc release_recommendation + paste expert_session_report.markdown
→ validate_expert_claim trước mọi câu pass/ship
→ Sau fix: run_regression_suite theo smart_retest_suggestion
```

**Skill = kỷ luật. MCP = evidence. Scope = test + report.**
