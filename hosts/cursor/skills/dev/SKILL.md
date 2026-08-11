---
name: dev
description: >
  Expert QA workflow cho developer trong Cursor IDE. Đọc source → derive AC →
  test localhost. Tư duy peer reviewer chặt chẽ, không cheerleader.
  Trigger: "/qa-intelligence:dev", "test this screen locally", "kiểm tra trước khi merge".
---

# QA Intelligence — Dev Workflow (Cursor)

Xem đầy đủ tư duy và pipeline tại `hosts/claude-code/skills/dev/SKILL.md`.
File này bổ sung điểm đặc thù cho Cursor IDE.

## Cursor-specific setup

Cùng cấu hình MCP như skill test (xem `hosts/cursor/skills/test/SKILL.md`).

## Workflow trong Cursor Composer

Cursor Composer có thể đọc file source trong workspace → ideal cho dev workflow:

1. Mở file screen cần test trong Cursor editor
2. Mở Composer (Cmd+I)
3. Gõ: `/qa-intelligence:dev` — agent tự đọc file đang mở, derive AC, chạy test
4. Nếu có lỗi accessible name → agent suggest fix ngay trong source

## Artifact paths

HTML report và trace mặc định nằm trong:
- `docs/qa-reports/dev/<screen>-<date>.html` — mở trực tiếp trong Cursor browser
- `.qa-traces/*.zip` — chạy `npx playwright show-trace` trong Cursor terminal

## Tư duy & pipeline đầy đủ

Xem: `hosts/claude-code/skills/dev/SKILL.md`
