---
name: test
description: >
  Expert QA tester workflow for QA Intelligence in OpenAI Codex / Codex CLI.
  Nhận URL + spec, đánh giá rủi ro, chạy pipeline, quyết định release.
  Trigger: "/qa-intelligence:test", "test this page", "QA this URL".
---

# QA Intelligence — Expert Tester (Codex)

Xem đầy đủ tư duy Expert QA tại `hosts/claude-code/skills/test/SKILL.md`.
File này bổ sung điểm đặc thù cho Codex CLI.

## Codex-specific setup

MCP server: thêm vào `~/.codex/config.yaml` hoặc project-level config:

```yaml
mcpServers:
  qa-intelligence:
    command: node
    args:
      - "<path>/dist/src/mcp/dev-entrypoint.js"
```

Build trước: `npm run build` trong thư mục QA-Intelligence.

## Remote MCP (staging/prod)

Dùng `hosts/mcp-remote.json.example` để kết nối remote MCP với OIDC bearer token.
Không bao giờ để `bearer_token` plain text trong config.

## Tư duy & quy trình đầy đủ

Xem: `hosts/claude-code/skills/test/SKILL.md`
