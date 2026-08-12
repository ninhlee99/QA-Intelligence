# Dogfood findings — companytools bug retest (DJ keyword AND/OR search)

Nguồn: dogfood thật trên repo `daijob6_companytools`, thử retest bug "keyword search
sai khi dùng or/and" bằng `/qa-intelligence:dev` skill. Ghi lại các lỗi/gap gặp phải
khi dùng `run_expert_qa`, `run_auto_qa`, `generate_test_cases`, `discover_ui_surface*`,
và chrome-devtools MCP, kèm đề xuất fix theo góc nhìn expert tester.

Ngày: xem git blame. Người test: dogfood session qua Claude Code.

**Status (2026-08-12):** BUG-1/2/3 + GAP-1/2/3/4 đã ship trên branch
`fix/dogfood-bugs-and-gaps`. GAP-5 (chrome-devtools) ngoài phạm vi repo — document only.

---

## Bug / lỗi

### BUG-1 / BUG-2 / BUG-3 — ✅ Fixed
Xem commit `fix(dogfood): unblock expert QA diagnostics and login UX`.

---

## Gap / tính năng

### GAP-1: Screenshot trong response — ✅ Fixed
- `include_screenshot=true` trên `discover_ui_surface`, `discover_ui_surface_after_login`,
  `execute_generated_test_case`, `run_auto_qa`, `run_expert_qa`
- Discovery trả `screenshot_path` (PNG full-page dưới `.qa-screenshots/`)
- Execution: `alwaysScreenshot` → PNG cả pass lẫn fail (path trong `evidence`)

### GAP-2: Oracle structural count — ✅ Fixed (partial)
- AC / assertion: `expected_result_count: { accessible_role, accessible_name_includes?, relation: eq|gte|lte, value }`
- Assert trên cleaned Semantic UI tree (không raw CSS)
- Cross-run subset/superset **chưa** — caller so sánh count tuyệt đối giữa 2 case
  (đủ cho dogfood AND/OR count check)

### GAP-3: Lite mode — ✅ Fixed
- `lite_mode=true` trên `run_auto_qa` / `run_expert_qa`
- Waive domain-pack / suite / E2 pass gates; `claim_pass_allowed` luôn false
  (`lite_mode:ad_hoc_no_pass_claim`)
- Ad-hoc 1 field không cần full Expert loop

### GAP-4: Multi-select + truncate — ✅ Fixed (documented + extended)
- `option_labels: string[]` trên AC (multi-select); engine `selectOption([{label}…])`
- `max_elements` (20–2000, default 120) trên discovery / auto QA
- `limitations` ghi rõ `selectable_options_not_enumerated_supply_option_label_or_option_labels`

### GAP-5: chrome-devtools MCP — Open / out of scope
Host Claude Code tool deferred visibility — không thuộc MCP server `qa-intelligence`.
Không sửa trong repo này.

---

## Tóm tắt

| # | Status |
|---|--------|
| BUG-1 | ✅ |
| BUG-2 | ✅ |
| BUG-3 | ✅ |
| GAP-1 | ✅ |
| GAP-2 | ✅ (count; subset cross-run deferred) |
| GAP-3 | ✅ |
| GAP-4 | ✅ |
| GAP-5 | Open / ngoài repo |

---

## Ghi chú dogfood context

Retest AND/OR keyword (companytools) lúc đầu bypass MCP vì BUG/GAP trên.
Sau fix: chạy lại `/qa-intelligence:dev` với:
- login_* đúng `accessible_name` (hoặc HTML `name=`)
- AC có `expected_result_count` cho từng query variant
- `include_screenshot=true` để xem UI
- `lite_mode=true` nếu chỉ cần smoke ad-hoc (không claim Expert pass)
