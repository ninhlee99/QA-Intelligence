# Coding Rules

- Implementation follows accepted specifications and interfaces.
- Core code SHALL NOT import provider SDKs; adapters/plugins own them.
- Workspace context is mandatory and immutable across scoped operations.
- Rules are deterministic and do not call LLMs.
- Commands and events use stable contracts and idempotency.
- Secrets never enter code, knowledge, logs, fixtures, or evidence.
- Tests cover contracts, failures, boundaries, isolation, cancellation, recovery, and provenance.
- TODOs cannot conceal missing policy or authority.
- Agent budgets, permissions, approvals, and termination are enforced outside prompts.
- Hidden chain-of-thought is neither logged nor required; retain externally checkable decisions and evidence.
- Evaluation failures distinguish subject, evaluator, infrastructure, invalid test, policy denial, and indeterminate outcomes.
- Critical invariants cannot be averaged away, and an LLM Judge cannot solely decide a critical release condition.
