# Plan: QA-Intelligence → Toàn Năng Test Agent

Date: 2026-08-05 (v2 — cập nhật sau khi ADR-018/SPEC-108 được thêm vào spec baseline)
Base: audit của `codex/requirement-review-agent` working tree + spec đã sửa trong phiên này.
Goal giữ nguyên: agent test toàn năng — mọi loại task, mọi business, kết nối được Claude/Cursor/Codex qua MCP.

## 0. Công nghệ đang dùng (bằng chứng: package.json, ADR-011)

- TypeScript strict + Node.js 24 LTS, ESM, không framework.
- Dependency thật duy nhất: `ajv` + `ajv-formats` (JSON Schema 2020-12). Không LLM SDK nào cài — Reasoning Provider hiện chỉ có bản scripted/replay, chưa gọi model thật.
- Persistence: SQLite (`node:sqlite`, **experimental**) local-first mặc định; Postgres optional cho shared/team profile (ADR-017).
- Test: Node built-in test runner (`node --test`), không Jest/Vitest.
- CI (`.github/workflows/repository-validation.yml`): validate governance (Python) → validate schema → typecheck → test → `npm audit`. Không gate GOV-012.

### Dùng làm plugin Claude Code / Codex / Cursor được chưa?

**Chưa.** Kiến trúc đã thiết kế đầy đủ (ADR-016) nhưng **0% code MCP tồn tại** — `plugins/README.md` ghi "Not started", grep repo không có dòng MCP nào.

Thiết kế khi làm xong (ADR-016 §2):
```
Host (Claude Code/Codex/Cursor) → Host Integration Package (thin) → MCP Interface → Agent Runtime/Evaluation Engine → Skills/Rules/Knowledge
```
- Host Integration Package **không chứa business logic** — chỉ metadata, MCP config, vài Skill/Rule mỏng. Logic thật dùng chung 1 core cho cả 3 host.
- Claude Code: `.claude-plugin/plugin.json` + hooks + MCP config.
- Codex: `.codex-plugin/plugin.json` + MCP config.
- Cursor: MCP config (project/global) + Cursor Rules.
- Transport: local `stdio`/socket (cá nhân) hoặc remote Streamable HTTP + OAuth (team).
- ADR-016 §8 tự khoá thứ tự: chỉ code MCP sau khi 1 capability lõi xong vertical; chỉ bật production sau GOV-012 G1–G4; public release cần thêm G5–G6.

→ Đây là **Giai đoạn 2** dưới đây, chưa bắt đầu.

## 1. Tình trạng thật (bằng chứng, không đoán)

### Đã implement (code thật, có test, 190/190 pass)
- Requirement Review Skill (`src/requirement-review/`): auth → discovery → deterministic rules → bounded LLM reasoning. **1/13** product capability (SPEC-203 trong SPEC-201..213).
- Agent Runtime lifecycle in-memory (`src/runtime/in-memory-agent-runtime.ts`, SPEC-606/508): state machine đầy đủ, idempotency, revision, budget, cancel.
- Evaluation Campaign: runner (1 trial) + coordinator (multi-trial, bounded parallel) + repository (in-memory) + record-store (SQLite thật qua `node:sqlite`, Postgres qua fake transaction manager).
- ADR-017: **SQLite-per-Workspace là default**, Postgres optional cho shared/team profile.
- Deterministic/replay adapters: `ScriptedEvaluationAdapter`, `ScriptedReasoningProvider`, `DeterministicWorkspaceAuthorizer`, `InMemoryKnowledgeSearch` — dùng cho test, không phải production.

### Đã sửa trong phiên này (spec-only, chưa có code) — ADR-018
- **SPEC-108 Memory Model** (mới): Memory tách bạch khỏi Knowledge Store — 2 tầng (Working/run-scoped, Session/TTL-scoped), đều non-authoritative.
  - §7.1 Save Decision Criteria: agent tự đánh giá reuse-likelihood/novelty/cost-of-being-wrong/provenance trước khi quyết lưu — mặc định KHÔNG lưu.
  - §7.3 Failure-Avoidance Retention: lỗi/defect/verdict sai tự sinh candidate tránh lặp lại (đáp ứng yêu cầu "tự học sau mỗi lần test").
  - §4.3 Applicability Scope: project-scoped (mặc định) vs cross-project/global (cần nhiều Workspace corroborate qua SPEC-105, không tự động).
- **AP-063 Proportional Rigor** + **AP-064 Context/Cost Efficiency** (ARCHITECTURE_PRINCIPLES.md): rigor tỷ lệ theo consequence class; bắt buộc reuse context/retrieval trong 1 run.
- **SPEC-508** thêm bảng budget cụ thể (token/time/tool-call) theo consequence class — trước đây chỉ có chữ "budget SHALL exist", không có số.
- **SSOT fix**: SPEC-107 §5 là canonical owner cho AI-adversarial-testing coverage (SPEC-206/213 reference); SPEC-210 §4 là canonical owner cho execution outcome vocab, thêm `flaky` là outcome riêng biệt (SPEC-209 reference).
- **SPEC-105** thêm §9a: phân biệt lỗi 1 lần (path nhanh qua SPEC-108) vs lỗi lặp lại (vẫn qua full governed candidate lifecycle).
- Toàn bộ index/matrix liên quan đã update, `python3 tests/validate_repository.py` + `node tests/validate-json-schemas.mjs` pass.

### Spec có, code KHÔNG có (Spec Only) — không đổi so với trước, cộng thêm SPEC-108
- 12/13 product capabilities: Discovery(201), Requirement Intelligence(202), Business Analysis(204), Risk Analysis(205), Test Strategy(206), Test Design(207), Test Data(208), Automation(209), Execution(210), Bug Analysis(211), Reporting(212), Agent/Skill Quality(213).
- **SPEC-108 Memory Model** — mới viết, 0% code. Đây là spec nền cho yêu cầu "agent tự nhớ, tự học từ lỗi cũ" — chưa có Working Memory, Session Memory, save-decision logic, hay failure-avoidance loop nào implement.
- Interfaces: Rule Engine(502), Plugin(503), Execution Engine(504), Event(505), Skill(509), Tool(510) — chỉ type mirror rải rác, không module/conformance suite riêng.
- Knowledge Repository (SPEC-401), Ontology Repository (SPEC-408) — không persistence/query component.
- Judge calibration/disagreement/drift (SPEC-310 §1/§6) — chưa có dòng code nào.
- MCP host-neutral facade + Claude Code/Cursor/Codex packages (ADR-016) — 0% code (xem §0 trên).
- `agents/`, `skills/` (thư mục promotion) — trống, chưa "tốt nghiệp" GOV-012.
- GOV-012 G1–G6 evidence — không tồn tại, không có trong CI.

### Rủi ro kỹ thuật đang mở
- `node:sqlite` experimental — cần quyết định trước khi vào production (xem §5).
- Postgres adapter chưa test với DB thật, chưa có `pg` driver trong package.json.
- SPEC-108 hiện chỉ là spec — nếu không implement kịp trước khi Giai đoạn 3 mở rộng ra 12 capability, memory/cost sẽ bị "để dành sửa sau" giống lỗi ban đầu.

## 2. Nguyên tắc giữ khi thay đổi

- Không đặt business rule vào prompt, không đặt provider behavior vào core module.
- Domain modules chỉ nói chuyện qua interface (Repository/Runtime/Adapter); SQLite/Postgres, Working/Session Memory đều là adapter/tầng ngang hàng sau seam, không rò rỉ chi tiết lên trên (ADR-017 §6, SPEC-108 §10).
- Rigor tỷ lệ theo consequence class (AP-063) — không áp dụng đồng loạt mọi thao tác như trước.
- Reuse context/retrieval trong 1 run là bắt buộc, không phải optimization tùy chọn (AP-064).
- Mỗi capability mới: spec accepted → deterministic core → adapter thật → GOV-012 evidence → "tốt nghiệp" lên `agents/`/`skills/`/`core/`/`api/`.
- Memory: mặc định KHÔNG lưu; chỉ lưu khi qua được §7.1 criteria; project-scoped là default, cross-project cần governed corroboration — không suy diễn ngược.
- Tracer bullet (Requirement Review) là khuôn mẫu cho 11 capability còn lại — lặp lại pattern, không phát minh lại.

## 3. Checklist theo giai đoạn

### Giai đoạn -1 — Spec quality (HOÀN THÀNH trong phiên này)
- [x] ADR-018 + SPEC-108 (Memory Model) + AP-063/AP-064 + SSOT fix (flaky, AI-testing coverage) + SPEC-105 §9a.
- [x] Toàn bộ index/matrix cập nhật, validator pass.

### Giai đoạn 0 — Vá tài liệu còn lại
- [x] ROADMAP.md: đã phản ánh ADR-017 (SQLite default) và ADR-018 (spec-quality update) — xong trong phiên này.
- [x] 0.1 Quyết định `node:sqlite` experimental: **giữ `node:sqlite`, không đổi `better-sqlite3`** — lý do: API tương đương, native binding vi phạm ADR-011 §5 (portability review) và phá vỡ baseline 2-dependency; rủi ro kiểm soát bằng `engines` pin (`>=24 <25`) + record-store đã có provider-neutral seam. Ghi vào ADR-017 §8 (v1.1.0).

### Giai đoạn 1 — Đóng nốt tracer bullet hiện tại (Requirement Review) trước khi nhân rộng
- [x] 1.1 SPEC-511 case còn thiếu: **code (`ScriptedEvaluationAdapter`, kể cả `replay()`) đã generic và hỗ trợ đủ mọi op từ trước — gap thật chỉ là thiếu test.** Đã thêm 5 test vào `tests/evaluation/scripted-evaluation-adapter.test.ts`: cancellation (failure code `cancelled`, không retry), replay không ghi đè trial gốc, replay báo `divergences`/`achieved_fidelity` tường minh thay vì im lặng khớp, `replay_unavailable` khi thiếu dependency, trial-isolation (1 trial không thể nhận/lộ scripted case của trial khác). 195/195 test pass, validator sạch.
- [x] 1.2 Postgres: đã cài PostgreSQL 18 local (brew `postgresql@18`, port 5433, song song không đụng `postgresql@14` sẵn có trên port 5432). Viết `PgTransactionManager` thật (`src/evaluation/pg-transaction-manager.ts`, dùng `pg` driver — thêm dependency, pure-JS không native binding nên không vi phạm ADR-011 §5). Migration `0001_evaluation_campaign_store.up.sql` áp lên DB thật. Test mới `tests/evaluation/pg-transaction-manager.real.test.ts` (skip sạch nếu thiếu `QA_INTELLIGENCE_TEST_POSTGRES_URL`, không chặn CI không có DB): chạy full shared contract suite + 3 test riêng — concurrent-writer race (`stale_revision` đúng 1 lần), RLS chặn query thiếu Workspace scope (phải dùng role non-superuser `qa_intelligence_app` vì Postgres superuser luôn bypass RLS/FORCE RLS), state sống sót qua `PgTransactionManager` mới (giả lập restart). 12/12 pass với DB thật.
- [x] 1.3 Agent Runner durable persistence: **seam mới `AgentRunRecordStore` (`src/runtime/agent-run-record-store.ts`) + `SqliteAgentRunRecordStore` (`src/runtime/sqlite-agent-run-record-store.ts`)** theo đúng pattern Evaluation Campaign, cộng shared contract suite (`tests/runtime/agent-run-record-store-contract.ts`) + test SQLite cụ thể, 8/8 pass. **Chưa làm**: nối seam này vào `InMemoryAgentRuntime` thật (runtime hiện vẫn dùng 4 `Map` nội bộ, chưa gọi qua record-store) — đó là bước composition riêng, rủi ro cao hơn vì phải sửa file 1724 dòng đang chạy nhiều test khác; để lại làm sau khi có nhu cầu thật (ví dụ khi 1.5 GOV-012 cần bằng chứng recovery-after-restart cho Agent Run, không chỉ Evaluation Campaign). Postgres adapter cho Agent Run (song song SQLite) cũng chưa làm — chỉ SQLite theo đúng local-first default (ADR-017).
- [x] **1.4 Implement SPEC-108 Memory cho Requirement Review**: `src/memory/working-memory.ts` (`WorkingMemoryKnowledgeSearch` — decorator quanh `KnowledgeSearch`, cache theo digest của query/scope/applicability/snapshot, invalidate tự động khi bất kỳ durable reference nào đổi, đúng AP-064 + SPEC-309 §4) và `src/memory/session-memory.ts` (`SessionMemory` — áp đúng 4 tiêu chí §7.1 trước khi lưu, chỉ cho fast path khi low-consequence + project-scoped theo §7.2/§4.3, TTL fail-safe theo §9, `reject()`/`invalidateWorkspace()` theo §7.2/§8). 14 unit test (`tests/memory/`) + 2 integration test chứng minh thật với `AssessRequirementQuality` (2 lần review cùng nội dung → Knowledge Search chỉ chạy 1 lần; review khác nội dung → chạy lại đúng 2 lần). Không sửa `in-memory-agent-runtime.ts` — Working Memory áp ở lớp `KnowledgeSearch` (đúng interface seam, không cần đụng runtime 1724 dòng). 220 test total (219 pass + 1 skip), validator sạch.
- [~] 1.5 GOV-012 G1–G4 evidence cho Requirement Review Skill: **cập nhật `governance/reviews/requirement-review-tracer-bullet/IMPLEMENTATION_EVIDENCE.yaml` + `GOV-012_GATE_RECORD.yaml`** phản ánh đúng công việc 1.1–1.4 (Postgres driver thật, Agent Run record-store, Memory) — thêm increment review mới, đóng các "pending" đã thật sự xong, số liệu validation cập nhật (219 pass/1 skip, 0 vulnerability). **Không thể full pass** — G2 (production OIDC), G3 (production Evaluation Adapter, không phải scripted), G4 (dataset đầy đủ, holdout, load test) đều cần công việc lớn hơn nhiều (LLM provider thật, OIDC identity service) ngoài phạm vi hợp lý của 1 phiên; "tốt nghiệp" lên `agents/`/`skills/` **chưa** xảy ra vì các gate chưa pass hoàn toàn — đúng bản chất, giả tạo evidence sẽ vi phạm chính GOV-012 §5 (override phải có approver độc lập, không thể tự cấp).
- [x] 1.6 CI: thêm block mới vào `tests/validate_repository.py` (chạy qua `npm run validate:repository`, đã có sẵn trong CI workflow `.github/workflows/repository-validation.yml` — không cần sửa YAML workflow) — mọi file thật (không phải README) trong `agents/`/`skills/` phải khớp `stem` với 1 subject có trong `GOV-012_GATE_RECORD.yaml` nào đó dưới `governance/reviews/`, nếu không sẽ fail CI. Test thật bằng cách tạo file giả `agents/fake-test-agent.json` — xác nhận fail đúng thông điệp, rồi xoá. Hiện `agents/`/`skills/` chỉ có README nên check pass sạch (chưa cái nào "tốt nghiệp"), nhưng từ giờ ngăn được việc thêm package thật vào đó mà thiếu evidence.
- [x] 1.7 Áp dụng bảng budget SPEC-508 §3.1 vào runtime thật: phát hiện bảng cũ dùng "Low/Medium/High" mơ hồ trong khi `ConsequenceClass` type thật có 4 giá trị (`advisory`/`reversible`/`controlled_side_effect`/`high_consequence`) — sửa spec dùng đúng 4 giá trị trước khi code (`reversible` và `controlled_side_effect` dùng chung mid-tier). Viết `src/runtime/default-budgets.ts` (`defaultAgentRunBudgets()`, `resolveAgentRunBudgets()` — override thắng field-by-field, không override thì fallback default). Chứng minh thật: build `AgentRunStartRequest` bằng `resolveAgentRunBudgets()` rồi gọi thẳng `InMemoryAgentRuntime.start()` — runtime chấp nhận, `high_consequence` vẫn đúng yêu cầu approval độc lập (budget table không bỏ qua approval gate). 10 test mới (6 unit + 4 integration với runtime thật). 230 test total (229 pass + 1 skip), validator sạch.

### Giai đoạn 2 — MCP host integration (bắt buộc để "kết nối Claude, Cursor, Codex")
- [x] 2.1 **Bỏ qua SPEC-503 (Platform Plugin) — không phải blocker thật cho MCP.** Đọc kỹ ADR-016 §3 xác nhận: SPEC-503 (Playwright/GitHub/Jira adapter) và "MCP Interface" là 2 khái niệm khác biệt hoàn toàn. Không cần SPEC-503 để làm MCP.
- [x] 2.2 Build MCP facade thật: **quyết định không dùng `@modelcontextprotocol/sdk`** (16 dependency trực tiếp — express/hono/zod/oauth/sse cho surface không cần ở dev-phase) — ghi **ADR-019** tự implement JSON-RPC 2.0 + MCP protocol tối thiểu (`initialize`/`tools/list`/`tools/call`/cancellation), byte-compatible với MCP chuẩn. Code: `src/mcp/jsonrpc.ts`, `src/mcp/protocol.ts`, `src/mcp/mcp-server.ts`, `src/mcp/stdio-transport.ts`, `src/mcp/agent-runtime-tool-registry.ts` (seam dịch `tools/call` → SPEC-508 Agent Runtime, module duy nhất trong `src/mcp/` biết tới Agent Runtime). 22 test mới (jsonrpc, mcp-server theo đúng ADR-019 §8 checklist, tool-registry integration với `InMemoryAgentRuntime` thật).
- [x] 2.3 Host packages thật tại `hosts/` (thư mục mới, tách biệt `plugins/` vì khác khái niệm theo ADR-016 §3): `hosts/claude-code/.claude-plugin/plugin.json`, `hosts/codex/.codex-plugin/plugin.json`, `hosts/cursor/mcp.json.example` — đều trỏ `dist/src/mcp/dev-entrypoint.js`. **Xác nhận thật bằng cách chạy đúng lệnh từ đúng working directory mỗi plugin dùng** — cả 2 chạy thành công qua stdio thật.
- [x] 2.4 (rút gọn) Conformance qua `dev-entrypoint.ts`: 1 request `tools/call` thật (`initialize` → `tools/call assess_requirement_quality`) chạy hết pipeline thật (authorization → Discovery → deterministic rules → evidence) qua stdio, trả `outcome: "completed", verdict: "pass"`. Phát hiện + sửa 1 bug thật trong lúc test: `resolveAgentRunBudgets()` mặc định set `max_tokens`, nhưng `RequirementReviewRuntimeExecutor` không track token usage khi chỉ dùng deterministic rule (không gọi reasoning) → mọi run tự động fail `budget_exhausted`. Sửa: thêm `budgets` override tường minh cho `AgentRuntimeToolDefinition` khi Skill không cần token budget. **Chỉ test 1 host thật (dev script mô phỏng); chưa test qua Claude Code/Codex/Cursor thật cài đặt** (cần môi trường ngoài phiên này).
- [ ] 2.5 stdio đã xong (dev); remote transport (OAuth) theo ADR-016 §8 — chưa làm, thuộc shared/team profile, chưa cần cho local-first default.
- [ ] 2.6 Memory Workspace-scope qua transport thật — chưa làm; `SessionMemory` (1.4) đã test Workspace-scope ở unit-level nhưng chưa nối vào MCP tool call nào.

### Giai đoạn 3 — Nhân rộng ra toàn bộ QA lifecycle (12 capability còn lại)
Lặp lại pattern tracer-bullet cho từng capability, **mỗi capability giờ bắt buộc bao gồm Memory (SPEC-108) và Proportional Rigor (AP-063) ngay từ đầu**, không để dành sửa sau như Requirement Review đã bị:

- [x] 3.1 **Discovery (SPEC-201) — tracer-bullet scope: Knowledge Store search only.** `src/discovery/public.ts` + `src/discovery/discover-product-context.ts` (`DiscoverProductContext` deep module): auth → search Knowledge Store theo từng scope độc lập → `DiscoveryReport` với Known/Unknown Register, Clarification Questions (chỉ hỏi khi scope thật sự rỗng), phân biệt rõ fact/inference/assumption/question (§66). Unavailable source → `limitations` (không phải "tính năng không tồn tại", đúng §10). Conflict Register có trong contract nhưng luôn rỗng — chưa có logic phát hiện mâu thuẫn semantic thật, không giả tạo. **Chưa làm** (đúng nêu rõ, không giả vờ đủ): SPEC-201 §8 Semantic UI Discovery (Page/Region/Feature/Action semantic model) — cần Platform Plugin (SPEC-503) + browser adapter (Playwright) chưa tồn tại; Product Surface Map, Semantic UI Map (2 trong 8 output của §5) không sinh ra được ở slice này. 7 test mới, 252 pass + 1 skip, validator sạch. Chưa nối Session Memory (1.4) vào Discovery finding — để dành khi có nhu cầu thật từ 1 capability khác cần reuse.
- [ ] 3.2 **Requirement Intelligence (202)** + **Business Analysis (204)** — mở rộng từ Requirement Review, dùng lại `DeterministicRuleEngine`/`KnowledgeSearch`/Memory seam.
- [ ] 3.3 **Risk Analysis (205)** — input cho Test Strategy.
- [ ] 3.4 **Test Strategy (206)** → **Test Design (207)** → **Test Data (208)** — chuỗi lõi sinh test case; đây là phần biến "review agent" thành "test agent" thật.
- [ ] 3.5 **Automation (209)** + **Execution (210)** — cần Tool Contract (SPEC-510) thật; chỗ agent thật sự "chạy test". Rủi ro lớn nhất về side-effect — Workspace isolation nghiêm; outcome vocab dùng đúng SPEC-210 §4 (bao gồm `flaky`).
- [ ] 3.6 **Bug Analysis (211)** + **Reporting (212)** — đóng vòng lặp; defect/verdict sai ở đây chính là input cho SPEC-108 §7.3 Failure-Avoidance Retention + SPEC-105 §9a recurrence detection.
- [ ] 3.7 **Agent/Skill Quality Assessment (213)** — tự đánh giá các agent/skill đã build ở 3.1–3.6 (dogfooding GOV-012), dùng canonical AI-testing coverage list ở SPEC-107 §5.

Mỗi mục 3.x: deterministic core → Memory save-decision cho observation loại đó → adapter thật → GOV-012 evidence → promote lên `agents/`/`skills/`.

### Giai đoạn 4 — Interface/Component nền còn thiếu (chặn nhiều capability ở giai đoạn 3)
- [ ] 4.1 Rule Engine Interface (502) thật — tách khỏi `assess-requirement-quality.ts` để tái dùng cho 202/204/205.
- [ ] 4.2 Execution Engine Contract (504) — cần cho 209/210.
- [ ] 4.3 Event Contract (505) — observability xuyên suốt.
- [ ] 4.4 Skill Contract (509) + Tool Contract (510) thật.
- [ ] 4.5 Knowledge Repository (SPEC-401) persistence thật — thiếu 6 command + 5 query (CreateDraft, Revise, SubmitReview, RecordDecision, Deprecate, Archive...).
- [ ] 4.6 Ontology Repository (SPEC-408) — component đọc/validate/serve `ontology/*.yaml`.
- [ ] 4.7 Judge calibration/disagreement/drift (SPEC-310 §1/§6).
- [ ] **4.8 (mới) Memory component thật** (SPEC-108) — Working Memory + Session Memory store, ranking-at-scale, làm 1 lần dùng chung cho mọi capability ở Giai đoạn 3, không làm riêng lẻ từng capability.

## 4. Thứ tự đề xuất tổng thể

1. Giai đoạn -1 — xong.
2. Giai đoạn 0 — còn 1 quyết định (`node:sqlite`), làm trước khi 1.2/1.3 chạm Postgres/SQLite thật.
3. Giai đoạn 1 (đóng tracer bullet, **gồm cả Memory 1.4**) — bắt buộc trước khi nhân rộng, tránh nợ kỹ thuật lan ra 12 capability sau đúng như đã xảy ra với Postgres-only trước đây.
4. Giai đoạn 4.8 (Memory component thật) nên làm ngay sau 1.4 chứng minh được pattern, trước khi mở Giai đoạn 3 — vì 3.1 Discovery đã cần Memory ngay.
5. Giai đoạn 2 (MCP) — sau khi 1 Skill graduate, trước khi mở rộng Giai đoạn 3, để mỗi capability mới có MCP conformance test từ đầu thay vì retrofit.
6. Giai đoạn 4 (còn lại: 502/504/505/509/510/401/408) xen kẽ Giai đoạn 3 — build đúng lúc có consumer thật.
7. Giai đoạn 3 lặp 3.1 → 3.7, mỗi vòng là 1 tracer-bullet mini kèm Memory + Proportional Rigor từ đầu.

## 5. Việc cần quyết định từ bạn (owner) trước khi code

- [ ] `node:sqlite` experimental — chấp nhận rủi ro hay đổi `better-sqlite3`?
- [ ] Thứ tự: Memory (1.4/4.8) và MCP (giai đoạn 2) cái nào trước? Plan đề xuất Memory trước (vì Giai đoạn 3 cần nó ngay từ Discovery), MCP sau. Nếu mục tiêu gần là demo kết nối Claude/Cursor/Codex sớm, có thể đảo.
- [ ] Trong giai đoạn 3, capability nào ưu tiên nghiệp vụ thật (có use case cụ thể chờ) — điều chỉnh thứ tự 3.1–3.7 theo đó thay vì thứ tự phụ thuộc lý thuyết.
- [ ] SPEC-108 §7.1/§7.3 (save-decision, failure-avoidance) cần threshold cụ thể (bao nhiêu lần lặp mới coi là "recurring" theo SPEC-105 §9a?) — hiện spec chỉ nói "SHALL", chưa có số, giống lỗ hổng budget đã vá ở SPEC-508. Cần quyết định số cụ thể khi implement 1.4.
