---
name: test
description: >
  Expert QA tester workflow for QA Intelligence in Cursor IDE. Nhận URL + spec,
  đánh giá rủi ro, chạy pipeline, quyết định release. Không bịa AC.
  Trigger: "/qa-intelligence:test", "test this page", "QA this URL",
  "run QA against staging", "kiểm tra tính năng này".
---

# QA Intelligence — Expert Tester (Cursor)

Xem đầy đủ tư duy Expert QA tại `hosts/claude-code/skills/test/SKILL.md`.
File này bổ sung các điểm đặc thù cho Cursor IDE.

## Cursor-specific setup

MCP server: thêm vào `.cursor/mcp.json` (xem `hosts/mcp.json.example`).
Restart Cursor sau khi cập nhật cấu hình.

```json
{
  "mcpServers": {
    "qa-intelligence": {
      "command": "node",
      "args": ["<path>/dist/src/mcp/dev-entrypoint.js"]
    }
  }
}
```

Build trước: `npm run build` trong thư mục QA-Intelligence.
Nếu tools không xuất hiện: kiểm tra Output > MCP trong Cursor.

## Cách dùng trong Cursor chat

1. Mở chat (Cmd+L) hoặc Composer (Cmd+I)
2. Gõ: `/qa-intelligence:test https://staging.example.com/login`
3. Agent tự đánh giá → hỏi thêm nếu thiếu spec/credentials
4. Kết quả HTML report mở được ngay trong Cursor (Cmd+click path)

## Trace debugging trong Cursor

Khi fail, trace nằm ở `.qa-traces/<id>.zip`:
```bash
npx playwright show-trace .qa-traces/<execution_id>_<attempt_id>_<ts>.zip
```
Playwright trace viewer mở browser tab — không cần rời Cursor terminal.

## Tư duy & quy trình đầy đủ

Xem: `hosts/claude-code/skills/test/SKILL.md`
