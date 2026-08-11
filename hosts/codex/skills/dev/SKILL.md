---
name: dev
description: >
  Expert QA workflow cho developer trong Codex CLI. Đọc source → derive AC →
  test localhost. Không cheerleader, không bịa pass.
  Trigger: "/qa-intelligence:dev", "test this screen locally", "kiểm tra trước khi merge".
---

# QA Intelligence — Dev Workflow (Codex)

Xem đầy đủ tư duy và pipeline tại `hosts/claude-code/skills/dev/SKILL.md`.
File này bổ sung điểm đặc thù cho Codex CLI.

## Codex-specific setup

Cùng cấu hình MCP như skill test (xem `hosts/codex/skills/test/SKILL.md`).

## Codex CLI workflow

```bash
# Chạy dev QA từ CLI
codex "/qa-intelligence:dev"

# Hoặc với context file
codex --context src/components/LoginForm.tsx "/qa-intelligence:dev"
```

Codex CLI đọc file context → agent tự derive AC → chạy `run_auto_qa` trên localhost.

## Tư duy & pipeline đầy đủ

Xem: `hosts/claude-code/skills/dev/SKILL.md`
