# Error Codes

| Code | Meaning | Retry Default |
|---|---|---|
| QAI-VALIDATION | Input violates a governed contract | No |
| QAI-UNAUTHORIZED | Authentication context is absent or invalid | No |
| QAI-FORBIDDEN | Actor lacks permission | No |
| QAI-NOT-FOUND | Exact scoped identity does not exist | No |
| QAI-CONFLICT | Revision, lifecycle, or semantic conflict | After resolution |
| QAI-INTEGRITY | Evidence, artifact, or package integrity failed | No |
| QAI-INDETERMINATE | Required facts or authority are insufficient | After evidence |
| QAI-UNAVAILABLE | Required dependency is temporarily unavailable | Policy-controlled |
| QAI-TIMEOUT | Bounded operation exceeded deadline | Policy-controlled |
| QAI-CANCELLED | Authorized cancellation completed | No |

Provider errors SHALL map to these stable categories without losing diagnostic provenance.

