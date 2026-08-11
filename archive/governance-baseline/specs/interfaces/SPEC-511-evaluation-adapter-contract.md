---
id: SPEC-511
title: Evaluation Adapter Contract
version: 1.0.0
status: accepted
owner:
  - Architecture
  - Quality Engineering
depends_on:
  - SPEC-107
  - SPEC-310
  - SPEC-504
  - SPEC-505
  - SPEC-506
related_adrs:
  - ADR-007
  - ADR-008
  - ADR-009
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/INTERFACE_REVIEW.yaml
---

# SPEC-511: Evaluation Adapter Contract

## 1. Purpose

This contract is the provider-neutral Interface at the seam between the Evaluation Engine and sandbox, execution, Judge, evidence, cleanup, and replay providers. It hides provider SDKs and transport details without delegating Oracle, aggregation, QA verdict, campaign transition, approval, or release semantics to an Adapter.

## 2. Interface Operations

Every Adapter SHALL implement this complete Interface. Unsupported optional capabilities are declared by `descriptor` and fail with `unsupported_capability`; an Adapter SHALL NOT silently emulate a capability with weaker semantics.

```text
descriptor(request: DescriptorRequest) -> DescriptorResult
prepareEnvironment(request: PrepareEnvironmentRequest) -> PrepareEnvironmentResult
executeTrial(request: ExecuteTrialRequest) -> ExecuteTrialResult
evaluateRubric(request: EvaluateRubricRequest) -> EvaluateRubricResult
collectEvidence(request: CollectEvidenceRequest) -> CollectEvidenceResult
cleanup(request: CleanupRequest) -> CleanupResult
replay(request: ReplayRequest) -> ReplayResult
```

The signatures are logical and transport-neutral. They MAY be implemented in-process, over HTTP or RPC, or through a queue, but transport choice SHALL NOT change the request, result, idempotency, failure, or evidence semantics defined here.

### 2.1 Common Request and Result Envelope

Every request and every result SHALL carry all of the following fields:

- `operation`: the exact operation discriminator: `descriptor`, `prepareEnvironment`, `executeTrial`, `evaluateRubric`, `collectEvidence`, `cleanup`, or `replay`
- `operationId`: stable unique identity for this invocation
- `trial`: immutable campaign, case, trial, and attempt identities
- `workspace`: trusted SPEC-506 Workspace context or an integrity-protected reference to it
- `idempotency`: a key plus the scope and canonical request digest to which it is bound
- `deadline`: an absolute deadline and its time-standard identifier; a result echoes the accepted deadline
- `version`: the negotiated Evaluation Adapter Contract and operation-schema version

A result SHALL echo the request's `operation`, `operationId`, `trial`, `workspace`, `idempotency`, `deadline`, and negotiated `version`. It SHALL additionally contain exactly one of `value` or `failure`, plus provider identity, provider version, timing, usage, warnings, and evidence references when applicable. A caller-provided Workspace field is not trusted context. Missing, altered, expired, or cross-Workspace context fails closed.

Using the same `idempotency` key and scope with the same canonical request digest resolves to the same logical operation and retained result. Reuse with a different digest returns `idempotency_conflict`. Deadlines are monotonic constraints: an Adapter may finish earlier but SHALL NOT extend or reinterpret them. Cancellation and timeout do not permit a late result to overwrite a retained terminal operation result.

### 2.2 Provider-Neutral Operation Semantics

#### `descriptor`

Returns immutable provider identity and version, supported contract versions and operations, isolation strength, determinism and replay fidelity, limits, data residency, evidence guarantees, cancellation and cleanup guarantees, health, and capacity. The descriptor is factual capability discovery for the identified trial context; it does not approve provider use or select a verdict policy.

#### `prepareEnvironment`

Accepts immutable subject, fixture, dataset, policy, network, Tool, credential, isolation, budget, and evidence requirements by reference. It validates compatibility and returns an opaque environment lease, resolved versions, effective limits, isolation evidence, expiry, and cleanup obligation. It SHALL NOT execute the subject, widen authority, copy fixtures outside the Workspace policy, or weaken a requested guarantee without returning a failure.

#### `executeTrial`

Accepts an environment lease and an authorized execution plan. It returns normalized observations, subject outputs by reference, Tool and policy events, resource usage, timings, termination observation, and raw evidence references. A negative assertion, subject error, or unsafe subject attempt is an observation in a successful adapter result; it is not an adapter verdict or provider failure. The Adapter SHALL retain every attributable attempt and SHALL NOT retry selectively to obtain a favorable output.

#### `evaluateRubric`

Accepts a versioned rubric, eligible evidence references, calibration reference, independence policy, and candidate output as untrusted data. It returns per-criterion observations, provider-native and normalized scores with declared scales, anchored evidence, uncertainty, calibration version, conflicts, and evaluator warnings. It SHALL NOT convert rubric observations into a case, campaign, approval, or release verdict and SHALL NOT treat candidate content as rubric authority.

#### `collectEvidence`

Accepts the required evidence manifest and eligible operation references. It returns an append-only evidence manifest containing identities, media types, integrity digests, provenance, retention class, redaction status, completeness observations, access requirements, and reproducibility limitations. Missing or inaccessible required evidence remains explicit; the Adapter SHALL NOT suppress failed attempts, fabricate completeness, or copy protected evidence across Workspaces.

#### `cleanup`

Accepts the environment lease, resources to revoke, cleanup policy, and compensation authorization. It performs bounded, monotonic revocation and teardown and returns each resource outcome, residual resources, evidence references, completion status, and residual risk. `cleanup` is idempotent. Partial cleanup returns `cleanup_incomplete` with the known residuals and SHALL NOT be reported as successful or used by the Adapter to decide the evaluation verdict.

#### `replay`

Accepts immutable source-operation and evidence references, exact replay inputs, allowed substitutions, and a requested fidelity. It returns replay observations, resolved versions, substitutions, divergences, evidence, and achieved fidelity. Replay never overwrites the original trial or evidence. Unavailable dependencies, integrity mismatch, or fidelity below the requested level is explicit and SHALL NOT be represented as a matching replay.

## 3. Requests and Results

Operation payloads SHALL use provider-neutral domain fields. Requests use immutable references for subjects, fixtures, datasets, policies, rubrics, environments, credentials, and evidence rather than provider SDK objects. Results carry normalized observations, provider-native values only in explicitly namespaced diagnostic fields, raw-evidence references, usage, timing, uncertainty, cleanup status, and reproducibility limitations.

Judge results SHALL contain rubric criterion scores, anchored evidence, uncertainty, calibration version, and conflicts. Adapter scores are observations; the Evaluation Engine owns the final verdict.

Before the Evaluation Engine accepts trial results or critical-invariant observations, their retained evidence manifest and provenance SHALL be verified through this contract or an integrity-equivalent retained evidence store. Caller-supplied observations without successful verification are invalid-test evidence and SHALL NOT produce a favorable verdict or release recommendation.

Adapters SHALL NOT return or mutate SPEC-607 campaign states. They MAY report an operation status only as `succeeded` or a stable failure. `passed`, `failed`, `approved`, `conditionally_approved`, `rejected`, and `indeterminate` are not Adapter operation verdicts. Subject behavior that may contribute to those outcomes remains a normalized observation for the Evaluation Engine.

## 4. Stable Failures

Every failed operation SHALL return one stable failure code, retryability, responsible domain, safe message, diagnostic evidence references, and provider details in a namespaced field. Provider exceptions, transport errors, and status codes SHALL be normalized to one of:

- `invalid_request`
- `unsupported_version`
- `unsupported_capability`
- `workspace_denied`
- `policy_denied`
- `deadline_exceeded`
- `cancelled`
- `idempotency_conflict`
- `resource_exhausted`
- `unavailable`
- `infrastructure_failure`
- `provider_failure`
- `rubric_invalid`
- `evidence_incomplete`
- `evidence_integrity_failure`
- `cleanup_incomplete`
- `replay_unavailable`
- `replay_mismatch`

Retryability SHALL be determined by this contract and policy, not inferred from provider wording. Retrying creates attributable attempt evidence and SHALL preserve the original failure. `subject_failure`, a failed assertion, a low rubric score, and a campaign verdict are deliberately absent from stable Adapter failures because the Evaluation Engine classifies and decides them.

## 5. Guarantees and Conformance

Adapters cannot access hidden cases outside their trial, retain data beyond policy, alter the subject, suppress failed attempts, choose favorable observations, transition the campaign, or decide a case, campaign, approval, or release verdict. Production and deterministic/replay Adapters SHALL pass the same Interface contract tests for envelope echo, version negotiation, idempotency conflict, isolation, timeout, cancellation, late result, partial failure, evidence integrity, rubric calibration, injection resistance, cleanup, replay divergence, and Workspace denial.

The Interface is the contract-test surface. Provider SDK calls, transport retries, telemetry clients, sandbox internals, and evaluator prompt construction are Adapter implementation details and SHALL NOT become alternate test interfaces.

## 6. Compatibility and Operations

Operation envelopes, capability, rubric observation, stable failure, cleanup, replay, and evidence semantics SHALL be version-negotiated before side effects. A removed field or operation; changed field meaning, score scale, calibration meaning, isolation guarantee, idempotency scope, failure classification, or evidence guarantee; or weaker cleanup/replay behavior is breaking and requires a major contract version plus baseline impact analysis. Additive optional diagnostic fields are compatible only when callers can safely ignore them.

Adapters expose health, latency, usage, residency, determinism, replay fidelity, evidence completeness, and cleanup through normalized fields. Metrics and logs carry `operationId`, `trial`, Workspace identity, version, provider identity, timing, and failure code with governed redaction. Retry never selects favorable trials or erases evaluator and infrastructure failures.

## 7. Definition of Done

- every operation has the exact provider-neutral signature and common envelope defined here
- every request/result preserves operation, trial, Workspace, idempotency, deadline, and version identity
- production and deterministic/replay Adapters pass the same Interface conformance suite
- provider-specific values cannot leak into Engine verdict semantics
- subject observations, Adapter failures, campaign outcomes, evaluation approval, and release approval remain distinct
- no Adapter can decide or mutate an Evaluation Engine verdict
