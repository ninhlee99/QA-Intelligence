# PB-014: Test a Skill

1. Validate identity, version, owner, dependencies, contract, and evaluation references.
2. Test positive triggers, negative triggers, ambiguity, competing Skills, and authority precedence.
3. Test valid, invalid, missing, boundary, and hostile inputs plus preconditions and postconditions.
4. Check every step, decision rule, Tool permission, evidence obligation, side effect, idempotency, compensation, failure, and escalation path.
5. Run without an LLM when behavior is deterministic; otherwise repeat trials and report variance.
6. Use deterministic fake/replay adapters, then approved provider conformance tests through the same contracts.
7. Test prompt injection, data leakage, cross-Workspace access, cancellation, timeout, and budget exhaustion.
8. Retain all evidence and issue a SPEC-213 recommendation; do not enable the Skill until PB-015 passes.

