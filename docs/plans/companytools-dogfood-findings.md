# Dogfood findings — companytools bug retest (DJ keyword AND/OR search)

Nguồn: dogfood thật trên repo `daijob6_companytools`, thử retest bug "keyword search
sai khi dùng or/and" bằng `/qa-intelligence:dev` skill. Ghi lại các lỗi/gap gặp phải
khi dùng `run_expert_qa`, `run_auto_qa`, `generate_test_cases`, `discover_ui_surface*`,
và chrome-devtools MCP, kèm đề xuất fix theo góc nhìn expert tester.

Ngày: xem git blame. Người test: dogfood session qua Claude Code.

**Status (2026-08-12):** BUG-1 / BUG-2 / BUG-3 đã được fix trong repo này. GAP-1..5
vẫn mở (xem bảng ưu tiên).

---

## Bug / lỗi cần fix (ưu tiên cao → thấp)

### BUG-1: `outcome: "blocked"` trả `output: null` toàn bộ, không đọc được blocker

**Tool**: `run_expert_qa`

**Status**: ✅ Fixed

**Root cause (đã xác nhận):** `RunExpertQaRuntimeExecutor` spread `auto_qa` vào
`skill_usage` trong khi MCP `allowed_skills` chỉ có `run-expert-qa` → Agent Runtime
`validateExecutionValue` fail `authorization_denied` → `#finalizeExecutionFailure`
set `outcome: blocked` + `output: null`, dù observation đã có `expert_checklist`.

**Fix:**
- Facade chỉ report skill `run-expert-qa` (wrapped skill ghi vào `citations`)
- `#finalizeExecutionFailure` giữ `observation.output` khi có (diagnostic không bị nuốt)
- `uncertainty.reasons` liệt kê luôn `blockers:` khi `claim_pass_allowed=false`

**Repro** (trước fix): gọi `run_expert_qa` đầy đủ params (login OK, product_root hợp lệ, domain pack
đã bootstrap), với `acceptance_criteria` chỉ có `statement` (không có
`expected_text`/`expected_url_includes`/`expected_network`).

**Kết quả trước fix**:
```json
{
  "outcome": "blocked",
  "output": null,
  "failure_class": "policy",
  "uncertainty": {
    "level": "high",
    "reasons": ["claim_pass_allowed=false — host must not green-wash; see expert_checklist.blockers"]
  }
}
```

---

### BUG-2: Login field phải khớp `accessible_name`, không chấp nhận raw HTML `name=`, lỗi không gợi ý field khả dụng

**Tool**: `run_expert_qa`, `run_auto_qa`

**Status**: ✅ Fixed

**Fix:**
- Fallback: HTML `name=` trên login page → resolve label/aria → map lại Semantic UI element
- Khi vẫn miss: message kèm danh sách `accessible_name` khả dụng (field/action)

---

### BUG-3: `generate_test_cases` không hỗ trợ trang cần login

**Tool**: `generate_test_cases`

**Status**: ✅ Fixed

**Fix:**
- Thêm login_* params (cùng contract 6-field như `run_auto_qa`) → `DiscoverAfterLogin`
- Khi UI map giống login gate + AC unbindable: finding `possible_auth_required` + hint trong
  `unbindable_criterion` (không đổ lỗi lên AC wording)

---

## Gap / thiếu tính năng cần bổ sung

### GAP-1: Không tool nào trả screenshot cho response thông thường

Toàn bộ discovery/execution chỉ trả semantic UI map (accessible_name/role dạng
JSON text), không có ảnh chụp màn hình kèm theo ở bất kỳ bước nào (chỉ có
`capture_ui_baseline` — dùng để so PNG hash, không phải để *xem*).

Expert tester luôn cần nhìn UI thật để bắt lỗi hiển thị, layout vỡ, element bị che,
overlay/modal chặn thao tác... — những lỗi mà semantic map không phản ánh được.

**Đề xuất**: mọi discovery/execution response nên có option (`include_screenshot:
true`) trả kèm ảnh (base64 hoặc file path) tại mỗi bước quan trọng — đặc biệt là
sau login và sau mỗi assertion fail.

---

### GAP-2: Không có oracle "structural/comparative" cho use case search/filter

`run_auto_qa`/`run_expert_qa` bắt buộc AC phải có oracle cố định:
`expected_text` / `expected_url_includes` / `expected_network`. Nhưng nhiều use
case QA thực tế — đặc biệt search/filter/sort — không có oracle tĩnh phù hợp vì
kết quả phụ thuộc dữ liệu (ví dụ: đếm số kết quả trả về, so sánh tập kết quả giữa
2 lần search khác điều kiện).

Đây chính là use case của bug vừa retest (so `java sqlite` / `java or sqlite` /
`java and sqlite` — cần so sánh **số lượng** và **tập hợp** kết quả, không phải
match text cố định).

**Đề xuất**: bổ sung oracle kiểu structural, ví dụ:
- `expected_result_count_relation`: so sánh count giữa 2 lần chạy (`>=`, `<=`, `==`,
  khoảng chấp nhận được)
- `expected_result_subset_of` / `expected_result_superset_of`: so tập kết quả (theo
  ID) giữa 2 test case, để assert quan hệ logic (OR ⊇ AND ⊇ giao)

---

### GAP-3: Không có "lite mode" để test nhanh 1 field mà không cần full pipeline

Muốn kiểm tra riêng 1 field/action cụ thể (ví dụ ô keyword search) phải đi qua
`run_expert_qa` full — kèm domain pack gate, risk matrix, learning hooks... Nặng và
dễ bị `blocked` bởi policy không liên quan trực tiếp đến câu hỏi đang test.

**Đề xuất**: thêm chế độ nhẹ (có thể là flag trên `execute_generated_test_case`
hoặc tool riêng) bỏ qua domain-pack gate cho các check ad-hoc, không cần đủ điều
kiện "Expert" claim.

---

### GAP-4: Chưa rõ mức hỗ trợ multi-select / dynamic form

Trang `resume_searches/new` có rất nhiều `<select>` multi-option — discovery trả
về 2256 elements nhưng bị truncate còn 120 (`"limitations": ["truncated_to_120_of_2256_elements"]`).
Chưa xác định được liệu `execute_generated_test_case`/`run_auto_qa` có điền được
multi-select/autocomplete hay chỉ hỗ trợ text field đơn giản.

**Đề xuất**: làm rõ + tài liệu hóa giới hạn hiện tại; nếu chưa hỗ trợ, đưa vào
roadmap vì form nghiệp vụ thật (đặc biệt HR/recruiting) dùng multi-select rất
phổ biến. Cân nhắc tăng giới hạn truncate hoặc cho phép discovery theo từng
section/form thay vì toàn trang.

---

### GAP-5 (chưa xác định rõ nguồn gốc): chrome-devtools MCP connected nhưng tool không xuất hiện

`claude mcp list` báo `chrome-devtools: ... ✔ Connected`, nhưng `ToolSearch` với
nhiều query khác nhau (`"chrome-devtools"`, `"mcp__chrome"`, tên tool cụ thể như
`navigate_page`/`fill`/`click`) đều trả `"No matching deferred tools found"`.

**Chưa rõ** đây là vấn đề của QA-Intelligence hay của host (Claude Code) — ghi lại
để tham khảo, không chắc thuộc phạm vi sửa của QA-Intelligence repo này. Không
liên quan trực tiếp tới MCP server `qa-intelligence` (server đó hoạt động bình
thường, riêng `chrome-devtools` là MCP server khác/độc lập).

---

## Tóm tắt ưu tiên

| # | Loại | Tool | Mức độ | Status |
|---|------|------|--------|--------|
| BUG-1 | Bug | `run_expert_qa` | **Cao** — chặn hoàn toàn khả năng debug | ✅ Fixed |
| GAP-1 | Gap | discovery/execution (toàn bộ) | **Cao** — thiếu năng lực cơ bản của tester | Open |
| GAP-2 | Gap | `run_auto_qa`/`run_expert_qa` | **Cao** — đúng use case vừa gặp bug thật, sẽ gặp lại | Open |
| BUG-2 | Bug | `run_expert_qa`/`run_auto_qa` | Trung bình — UX, có workaround (gọi discover trước) | ✅ Fixed |
| BUG-3 | Bug | `generate_test_cases` | Trung bình — UX, có workaround (dùng run_auto_qa thay) | ✅ Fixed |
| GAP-3 | Gap | pipeline nói chung | Trung bình — ảnh hưởng tốc độ dev/test lặp | Open |
| GAP-4 | Gap | discovery/execution | Thấp/trung bình — cần làm rõ trước, chưa chắc là thiếu | Open |
| GAP-5 | Không rõ | chrome-devtools MCP | Thấp — có thể ngoài phạm vi repo này | Open |

---

## Ghi chú thêm — context bug đã retest thành công (không qua các gap trên)

Vì các lỗi/gap ở trên, việc retest thật sự được hoàn thành bằng cách **bỏ qua MCP
pipeline** và verify trực tiếp qua: curl giả lập POST form (đã login qua session
cookie thật) + `rails runner` đọc thẳng DB dev. Đây **không phải** E2E qua UI thật
theo chuẩn Expert QA của skill — không có screenshot, không có browser thật, không
có test case chuẩn hóa theo `run_auto_qa`.

Số liệu thu được trên DB dev thật sau khi apply fix (`daijob6_shared/app/models/concerns/common_utils.rb`):
- `java sqlite` (AND mặc định) → 247 kết quả
- `java or sqlite` → 236 kết quả
- `java and sqlite` → 234 kết quả

Không còn hiện tượng nổ số kiểu bug gốc (2648). Đối chứng thêm: nếu không có fix,
riêng literal `%or%` match 314,060 bản ghi trong DB dev — khớp pattern lỗi gốc.

Nếu các BUG/GAP ở trên được fix, nên chạy lại full flow `/qa-intelligence:dev` cho
bug này để có report chuẩn (`expert_session_report.markdown`) thay thế cho cách
verify thủ công này.
