# Slash commands

| Command | Who |
|---------|-----|
| `/qa-intelligence:test` | Tester — URL + spec |
| `/qa-intelligence:dev` | Dev — URL + source/ticket AC |

Env = URL. Expert bar = `hosts/references/expert-tester-workflow.md`.

On each request the agent **auto-bootstraps** `domain-knowledge/` in the product repo from `hosts/templates/domain-knowledge/` using the request context (see `hosts/references/domain-pack.md`).

```
/qa-intelligence:test https://staging.example.com/login
/qa-intelligence:dev http://localhost:3000/settings
/qa-intelligence:test retest case_ids TC-1,TC-2 suite <id>
```
