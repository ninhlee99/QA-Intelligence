# Slash commands

Only **two** main commands. Environment = URL the user passes.

| Command | Skill | Who |
|---------|-------|-----|
| `/qa-intelligence:test` | `test` | Tester — URL + spec |
| `/qa-intelligence:dev` | `dev` | Dev — URL + source/ticket AC |

Both follow `hosts/references/expert-tester-workflow.md`.

Retest examples:

```
/qa-intelligence:test retest case_ids TC-1,TC-2 suite <id>
/qa-intelligence:dev retest screen https://staging.example.com/login
/qa-intelligence:test retest related_defect_ids DEF-DRAFT:TC-1
```
