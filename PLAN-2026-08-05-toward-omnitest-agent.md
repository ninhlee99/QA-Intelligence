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
- [ ] 1.2 Postgres: `pg` driver thật, `PostgresTransactionManager` thật, test với DB thật (docker/testcontainers) — restart, concurrent-writer, RLS.
- [ ] 1.3 Agent Runner durable persistence: hiện chỉ in-memory; cần SQLite/Postgres record-store cho Agent Run state (như đã làm cho Evaluation Campaign).
- [ ] **1.4 (mới) Implement SPEC-108 Memory cho Requirement Review**: Working Memory trong `in-memory-agent-runtime.ts` (reuse context/retrieval theo AP-064), Session Memory + save-decision policy (§7.1) cho ít nhất 1 loại observation thật (ví dụ: kết quả Discovery lặp lại trong cùng Workspace). Đây là nơi tốt nhất để chứng minh kiến trúc Memory trước khi nhân rộng — tracer bullet nhỏ bên trong tracer bullet.
- [ ] 1.5 Chạy GOV-012 G1–G4 evidence cho Requirement Review Skill (PB-011/PB-012) để "tốt nghiệp" lên `agents/` + `skills/`.
- [ ] 1.6 CI: thêm bước kiểm tra GOV-012 gate evidence tồn tại trước khi merge liên quan agent/skill promotion.
- [ ] 1.7 Áp dụng bảng budget SPEC-508 §3.1 vào runtime thật — đo được token/time/tool-call theo consequence class, không chỉ lý thuyết.

### Giai đoạn 2 — MCP host integration (bắt buộc để "kết nối Claude, Cursor, Codex")
- [ ] 2.1 Implement SPEC-503 Plugin Contract thật (hiện spec-only).
- [ ] 2.2 Build host-neutral MCP facade theo ADR-016 (`plugins/` hiện trống).
- [ ] 2.3 Thin host packages: Claude Code (`.claude-plugin/plugin.json` + hooks), Codex (`.codex-plugin/plugin.json`), Cursor (MCP config + Rules) — không chứa business logic.
- [ ] 2.4 Conformance test: 1 Skill (Requirement Review) chạy được qua cả 3 host, kết quả giống nhau (modulo transport).
- [ ] 2.5 stdio + remote transport (OAuth) theo ADR-016 §8.
- [ ] 2.6 Memory Workspace-scope (SPEC-108 §8) phải test được qua transport thật — 1 host không được đọc Session Memory của Workspace do host khác mở.

### Giai đoạn 3 — Nhân rộng ra toàn bộ QA lifecycle (12 capability còn lại)
Lặp lại pattern tracer-bullet cho từng capability, **mỗi capability giờ bắt buộc bao gồm Memory (SPEC-108) và Proportional Rigor (AP-063) ngay từ đầu**, không để dành sửa sau như Requirement Review đã bị:

- [ ] 3.1 **Discovery (SPEC-201)** — nền tảng lấy context/input. Làm trước; kết quả Discovery là ứng viên Session Memory tự nhiên đầu tiên (ví dụ selector, endpoint đã khám phá).
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
