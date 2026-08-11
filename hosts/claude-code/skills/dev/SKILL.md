---
name: dev
description: >
  Expert QA workflow cho developer. Đọc source code → derive AC → test
  localhost trước khi push. Tư duy peer reviewer chặt chẽ, không cheerleader.
  Trigger: "/qa-intelligence:dev", "test this screen locally", "run dev QA",
  "test against localhost", "kiểm tra trước khi merge".
---

# QA Intelligence — Dev Workflow (Expert QA stance)

Vai trò: Developer đang tự QA code của mình trước khi push — với tư duy của Expert QA Engineer, không phải "chạy cho xong CI".

**Nguyên tắc:** Code là nguồn sự thật AC. Không đoán behavior. Không bỏ qua lỗi nhỏ. Claim pass chỉ khi `release_recommendation` cho phép.

---

## Bước 0 — Đánh giá scope trước khi làm

Hỏi bản thân:

1. **Thay đổi này ảnh hưởng gì?**
   - UI + form → cần test case mọi variant (positive/negative/boundary/adversarial)
   - API endpoint → cần `execute_api_smoke` song song
   - Auth / permission → cần `discover_and_compare_role_ui_surfaces`
   - Navigation/routing → cần `discover_ui_workflow` + `generate_journey_test_cases`

2. **Đã có regression suite chưa?**
   - Có → `run_regression_suite` trước (nhanh hơn re-generate)
   - Chưa → full pipeline → register suite sau

3. **Có thể regression break gì khác không?**
   - Shared component → chạy thêm suite của những screen dùng chung

---

## Pipeline chuẩn (tính năng mới)

```
1. Đọc source → derive AC
   - Mỗi required field → test case positive + negative + boundary
   - Submit trigger API → ghi expected_network (url_includes + status)
   - Navigation → expected_url_includes / expected_title_includes
   - Tên field trong code phải khớp accessible_name thật trên UI

2. register_requirement với AC đầy đủ
   → giữ requirement_ref (id@version) để dùng lại

3. discover_ui_surface trên localhost URL
   → Kiểm tra accessible names khớp với AC không
   → Nếu sai → sửa code trước khi test

4. run_auto_qa với acceptance_criteria + requirement_ref + output_path
   → output_path: "docs/qa-reports/dev/<screen>-<date>.html"
   → Đọc generation_findings: nếu AC không bind được → sửa accessible name

5. Đọc kết quả ngay:
   a. release_recommendation trước tiên
   b. Defects → mỗi cái đều có evidence (screenshot / trace)
   c. Unbindable AC → đây là lỗi trong code hoặc AC, không phải bỏ qua
   d. Flaky → điều tra trước khi push

6. [Có API] generate_api_smoke_from_openapi (include_authz_negatives=true)
   → execute_api_smoke
   → Không claim API pass từ happy path 200 đơn thuần

7. register_regression_suite → giữ suite_id

8. [Lần đầu] capture_ui_baseline + register_ui_surface_baseline
   → Lần sau so sánh baseline ngay sau run

9. Nếu có fail → xem .qa-traces/*.zip trước khi report cho QA
   → npx playwright show-trace <path>
```

---

## Pipeline regression (sau fix)

```
1. list_regression_suites → lấy suite_id
2. run_regression_suite với case_ids hoặc related_defect_ids
   (chỉ subset liên quan đến fix)
3. compare_ui_baseline nếu fix UI layout
4. compare_ui_surface_to_baseline nếu thêm/xóa control
5. Đọc release_recommendation → không đọc pass count
6. list_failure_avoidance_hints → lỗi cũ đã được nhớ chưa?
```

---

## Đọc kết quả — thứ tự bắt buộc

1. `release_recommendation` — nếu không phải `release` → phải fix trước khi push
2. `security_incident` / `critical` severity → block push hoàn toàn
3. `unlabeled_editable_field` (a11y) → fix accessible name
4. Unbindable AC (`not_executed`) → sửa source hoặc AC
5. Flaky → phân tích trace, đừng re-run hy vọng pass
6. Residual risks → document trong PR description

---

## Coverage — nói thật trong PR

Sau mỗi test session, tự ghi vào PR:

```
QA coverage:
- UI: run_auto_qa trên /path/to/screen — release_recommendation: [value]
- Variants tested: positive/negative/boundary/adversarial
- API: [tested với execute_api_smoke / chưa test — lý do]
- Auth: [tested role A vs B / chỉ one role]
- Browser: [chromium only / chromium+firefox]
- Not tested: full WCAG, load, pen-test
- Artifacts: [HTML path], suite_id: [id]
```

---

## Sau deploy lên staging

```
1. register_workspace_environment cho staging base URL
2. run_regression_suite (update base_url)
3. [nếu UI thay đổi] run_auto_qa lại trên staging
4. compare_ui_baseline staging vs localhost (nếu có)
```

---

## Quy tắc không được vi phạm

| Không bao giờ | Thay vào đó |
|---|---|
| Push khi `release_recommendation` = `do_not_release` | Fix trước, chạy lại |
| Bỏ qua unbindable AC | Sửa accessible name trong source |
| Re-run flaky hy vọng pass | Xem trace → tìm root cause |
| Claim "tested" khi chỉ chạy happy path | Khai rõ scope trong PR |
| `execute_browser_test` trên localhost thật | Dùng `run_auto_qa` |
| Password plain text trong input | `register_workspace_secret` → `password_secret_ref` |
