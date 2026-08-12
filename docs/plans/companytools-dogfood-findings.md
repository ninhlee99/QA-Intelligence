# Dogfood findings — companytools bug retest (DJ keyword AND/OR search)

Nguồn: dogfood thật trên repo `daijob6_companytools`, thử retest bug "keyword search
sai khi dùng or/and" bằng `/qa-intelligence:dev` skill. Ghi lại các lỗi/gap gặp phải
khi dùng `run_expert_qa`, `run_auto_qa`, `generate_test_cases`, `discover_ui_surface*`,
và chrome-devtools MCP, kèm đề xuất fix theo góc nhìn expert tester.

Ngày: xem git blame. Người test: dogfood session qua Claude Code.

**Status (2026-08-12):** BUG-1/2/3 + GAP-1/2/3/4 ship trên `fix/dogfood-bugs-and-gaps`.
WORKFLOW-1 (AC binding) documented in Expert workflow — not a “headless” bug.

---

## Root cause thật (retest browser bị kẹt)

Tool **đã** dùng browser thật (Playwright/Chrome). Không phải “giả lập HTTP” hay
“headless vs real”.

Hai lớp:

1. **Discovery** — mở page thật, list Semantic UI elements → thường OK.
2. **Test generation** — AC text → bind element + type/click/select + oracle.
   AC chỉ mô tả logic nghiệp vụ (“OR phải rộng hơn AND”) **không** đủ → generator
   **cố ý không bịa** thao tác (SPEC-207 §6) → unbound / skip.

Cải thiện giống end-user thật: **discover trước → viết AC = action + input + oracle**
(dùng đúng `accessible_name` từ map). So sánh 2 search: 2 case +
`expected_result_count` tuyệt đối (hoặc so thủ công); seed fixture data, đừng dựa
dev DB ngẫu nhiên. Chi tiết: `hosts/references/expert-tester-workflow.md` § G2→G3.

---

## Bug / lỗi

### BUG-1 / BUG-2 / BUG-3 — ✅ Fixed
Xem commit `fix(dogfood): unblock expert QA diagnostics and login UX`.

---

## Gap / tính năng

### GAP-1…4 — ✅ Fixed (xem commit feat GAP)
### GAP-5 chrome-devtools — Open / ngoài repo
### WORKFLOW-1 AC binding — ✅ Documented (skill + workflow); code không “tự suy luận” AC

---

## Next (khi companytools sẵn sàng)

1. `discover_ui_surface_after_login` trên `/resume_searches/new`
2. Viết lại AC với `キーワード` / `検索` (hoặc label thật) + `expected_result_count`
3. `run_expert_qa` / `lite_mode` + `include_screenshot` — gõ+submit thật trên browser
4. So count AND vs OR trên fixture đã seed
