---
id: ADR-002
title: Rule Engine Before LLM
status: accepted
version: 1.0.0
date: 2026-07-31
decision_owners:
  - Architecture
  - Knowledge
  - AI Governance
related_specs:
  - SPEC-002
  - SPEC-003
  - SPEC-004
  - SPEC-005
  - SPEC-006
related_adrs:
  - ADR-001
supersedes: []
superseded_by: null
---

# ADR-002: Rule Engine Before LLM

## 1. Context

QA Intelligence combines deterministic software components with probabilistic AI models.

The platform must analyze requirements, discover applications, infer business behavior, identify risks, design tests, generate automation, evaluate executions, and learn from validated observations.

Some decisions can be derived from explicit and authoritative information, including:

* business rules
* validation constraints
* application metadata
* project configuration
* knowledge objects
* schemas
* governance policies
* deterministic mappings
* previously validated decisions

Other decisions require interpretation or inference because the available information is incomplete, ambiguous, unstructured, or contextual.

Large Language Models are useful for interpreting such information. However, their outputs are probabilistic and may vary across executions, models, prompts, and context windows.

The system therefore requires a clear execution order between deterministic rules and probabilistic reasoning.

## 2. Problem

Without a defined decision hierarchy, modules may send every task directly to an LLM.

This creates several risks:

* authoritative rules may be ignored or contradicted
* identical inputs may produce different outputs
* business logic may become embedded in prompts
* decisions may be difficult to audit
* model changes may alter system behavior unexpectedly
* token usage and operating cost may increase unnecessarily
* hallucinated constraints may be treated as facts
* testing and debugging may become unreliable
* individual agents may implement conflicting reasoning behavior

QA Intelligence must use AI for interpretation and reasoning without allowing the LLM to replace deterministic knowledge or established rules.

## 3. Decision

QA Intelligence SHALL evaluate applicable deterministic rules before invoking an LLM.

The default decision pipeline is:

```text
Input
  ↓
Schema Validation
  ↓
Knowledge Retrieval
  ↓
Rule Resolution
  ↓
Deterministic Result Available?
  ├── Yes → Produce Result with Evidence
  └── No
       ↓
     LLM Reasoning
       ↓
     Output Validation
       ↓
     Confidence and Governance Evaluation
       ↓
     Result, Escalation, or Knowledge Candidate
```

An LLM may only reason over unresolved, ambiguous, contextual, or generative portions of a task.

An LLM MUST NOT override an applicable authoritative rule unless an explicit conflict-resolution or human-approval workflow permits it.

## 4. Decision Rules

### 4.1 Deterministic precedence

When a valid deterministic rule completely resolves a decision, the system MUST use that result without asking an LLM to independently decide the same question.

Example:

```text
Business Rule:
Password minimum length = 12

Result:
Generate boundary tests for 11, 12, and 13 characters.
```

The LLM may help describe or organize those tests, but it MUST NOT change the minimum length.

### 4.2 Partial resolution

When deterministic rules resolve only part of a task, the resolved values MUST be locked before LLM reasoning begins.

Example:

```text
Resolved by Rule Engine:
- minimum length: 12
- maximum length: 64
- required character classes: uppercase and number

Unresolved:
- likely user mistakes
- abuse scenarios
- prioritization rationale
```

The LLM may reason only over the unresolved portion.

### 4.3 Rule absence

The absence of a rule MUST NOT be interpreted as permission, prohibition, or a business requirement.

When no applicable rule exists, the system may:

1. search additional knowledge scopes
2. perform discovery
3. derive an explicit inference
4. request clarification
5. create a knowledge candidate

Any inferred result MUST be distinguished from authoritative knowledge.

### 4.4 Conflicting rules

When multiple applicable rules conflict, the Rule Engine MUST apply the defined precedence model.

The initial precedence order is:

```text
Governance Policy
  ↓
Validated Project Rule
  ↓
Validated Feature Rule
  ↓
Validated Screen or API Rule
  ↓
Organization Rule
  ↓
Global Default
```

More specific scope does not automatically override a higher-authority governance policy.

If the conflict cannot be resolved deterministically, the system MUST escalate it. The LLM may explain the conflict but MUST NOT silently select a rule.

### 4.5 LLM output validation

Every LLM output that affects system behavior MUST be validated against:

* schemas
* applicable business rules
* governance restrictions
* allowed values
* ownership boundaries
* confidence requirements
* traceability requirements

Invalid output MUST be rejected, corrected through a controlled retry, or escalated.

### 4.6 Rule traceability

Every rule-derived decision MUST record:

* rule identifier
* rule version
* rule source
* knowledge scope
* input facts
* output
* evaluation timestamp

Every mixed rule-and-LLM decision MUST distinguish deterministic conclusions from inferred conclusions.

### 4.7 No business logic in prompts

Prompts MUST NOT be the authoritative storage location for business rules.

Prompts may contain retrieved rules as execution context, but the authoritative version MUST remain in the Knowledge Store or governed configuration.

### 4.8 Model independence

Core business behavior MUST remain stable when the underlying LLM provider or model changes.

Changing an LLM may affect reasoning quality, language, or ranking of inferred possibilities. It MUST NOT change deterministic rules.

## 5. Rationale

### 5.1 Reliability

Deterministic rules produce repeatable outcomes for identical inputs.

This makes core system behavior easier to verify, test, and audit.

### 5.2 Explainability

Rule evaluation provides direct evidence for why a decision was made.

An explanation such as:

```text
Generated because BR-AUTH-014 requires accounts to lock after five failed attempts.
```

is stronger than an unsupported model-generated explanation.

### 5.3 Safety

Authoritative rules may represent security requirements, privacy controls, compliance restrictions, or critical business behavior.

These rules must not be weakened by probabilistic inference.

### 5.4 Cost efficiency

Rule evaluation is generally faster and less expensive than invoking an LLM.

Using deterministic processing first reduces unnecessary model calls and context size.

### 5.5 Maintainability

Separating rules from prompts allows teams to update business behavior without redesigning prompts or retraining models.

### 5.6 Testability

Rule Engine behavior can be covered through deterministic unit and integration tests.

This creates a stable baseline around which probabilistic AI behavior can be evaluated.

## 6. Alternatives Considered

### 6.1 LLM-first reasoning

In this approach, all available context is sent to an LLM, which decides what rules apply.

This alternative was rejected because:

* applicable rules may be missed
* outputs may be inconsistent
* authoritative and inferred information may be mixed
* behavior may change across models
* traceability is weak
* business logic becomes prompt-dependent

### 6.2 Prompt-embedded rules

In this approach, business rules are maintained directly inside prompt templates.

This alternative was rejected because:

* prompts become a hidden source of truth
* rule versions are difficult to manage
* duplicated prompts may contain conflicting rules
* rule changes become difficult to audit
* non-LLM components cannot reliably consume the rules

### 6.3 LLM-generated rules without validation

In this approach, the LLM converts requirements into rules and immediately uses them.

This alternative was rejected because inferred rules may be incomplete, incorrect, or unsupported.

LLMs may propose knowledge candidates, but those candidates must pass normalization, conflict detection, confidence evaluation, and validation before becoming authoritative.

### 6.4 Rules-only system

In this approach, all behavior is implemented deterministically without an LLM.

This alternative was rejected because many QA activities require interpretation, semantic analysis, contextual reasoning, and generation over incomplete information.

The system requires both deterministic and probabilistic intelligence.

## 7. Consequences

### 7.1 Positive consequences

* deterministic behavior for known rules
* clearer decision explanations
* stronger auditability
* reduced LLM usage
* easier automated testing
* safer business-rule enforcement
* improved model portability
* consistent behavior across agents
* cleaner separation between knowledge and inference

### 7.2 Negative consequences

* the Rule Engine becomes a critical platform dependency
* rules require formal schemas and lifecycle management
* conflict-resolution logic must be implemented
* mixed deterministic and probabilistic outputs require provenance
* additional orchestration is needed before and after LLM calls
* poorly maintained rules may prevent valid reasoning

### 7.3 Accepted trade-offs

QA Intelligence accepts the additional complexity of rule management in exchange for reliability, explainability, and governance.

The Rule Engine is not intended to replace AI reasoning. It constrains and grounds that reasoning.

## 8. Risks and Mitigations

### Risk: Rules become outdated

An outdated rule may produce a confidently incorrect result.

Mitigations:

* version every rule
* store provenance
* support effective and expiration dates
* track validation status
* detect conflicts with newer evidence
* allow controlled deprecation

### Risk: Excessive rules reduce flexibility

Too many highly specific rules may make the system difficult to evolve.

Mitigations:

* distinguish policies, business rules, defaults, and heuristics
* avoid encoding contextual judgment as a hard rule
* use scoped rules
* periodically review rule usage
* retain LLM reasoning for genuinely ambiguous situations

### Risk: Agents bypass the Rule Engine

An agent may call an LLM directly and produce an inconsistent result.

Mitigations:

* provide a centralized orchestration interface
* prohibit direct model invocation for governed decisions
* add architectural tests
* log decision paths
* enforce dependency boundaries

### Risk: LLM output contradicts resolved facts

The model may return a result inconsistent with locked rule-derived values.

Mitigations:

* pass resolved facts as immutable constraints
* validate structured output
* reject contradictions
* record retry reasons
* escalate repeated failures

### Risk: Rule conflicts are silently resolved

Incorrect precedence behavior may hide important inconsistencies.

Mitigations:

* make conflict detection explicit
* preserve all conflicting sources
* require evidence for resolution
* escalate unresolved conflicts
* never overwrite conflicting rules silently

## 9. AI Guidance

### AI Coding Agents MUST

* query authoritative knowledge and rules before implementing probabilistic reasoning
* use the Rule Engine through its defined interface
* preserve rule identifiers and versions in decision traces
* distinguish authoritative facts from inferred conclusions
* validate LLM outputs against applicable rules and schemas
* implement deterministic unit tests before model-based tests
* treat unresolved conflicts as explicit states
* keep model-provider code behind an abstraction boundary
* propagate rule evidence to downstream artifacts

### AI Coding Agents MUST NOT

* embed authoritative business rules only in prompts
* call an LLM when an applicable rule completely resolves the task
* allow an LLM to silently override a rule
* interpret missing rules as implied requirements
* persist model output as authoritative knowledge without validation
* merge inferred and validated values without provenance
* hide rule conflicts
* duplicate Rule Engine logic inside individual agents
* make business behavior dependent on a specific LLM provider

### AI Runtime Agents MUST

* retrieve relevant knowledge before reasoning
* evaluate rules before generation
* lock resolved values
* reason only over unresolved portions
* report confidence for inferred conclusions
* provide evidence for rule-derived conclusions
* create knowledge candidates rather than authoritative knowledge when learning from inference

### AI Runtime Agents MUST NOT

* represent an inference as a confirmed business rule
* invent constraints when the source is missing
* modify authoritative knowledge directly
* bypass escalation thresholds
* treat conversation history as stronger evidence than validated knowledge

## 10. Compliance

An implementation complies with this ADR when:

* all governed decision workflows evaluate rules before LLM invocation
* applicable rule results are preserved as immutable constraints
* LLM outputs are validated after generation
* business rules are stored outside prompts
* deterministic and inferred outputs have separate provenance
* rule conflicts are explicitly detected
* model replacement does not change deterministic behavior
* automated tests verify rule precedence and conflict handling
* direct agent-to-LLM paths cannot bypass required governance

Non-compliant examples include:

```text
Requirement → LLM → Test Cases
```

when structured rules are available.

```text
Prompt Template → Embedded Business Rules
```

when no authoritative rule object exists.

```text
LLM Output → Knowledge Store
```

without validation and candidate processing.

The compliant pattern is:

```text
Requirement
  ↓
Knowledge Retrieval
  ↓
Rule Engine
  ↓
LLM for Unresolved Reasoning
  ↓
Validation
  ↓
Governed Result
```

## 11. Related Decisions

* ADR-001 establishes the Knowledge Store as the authoritative source for persisted knowledge.
* A future ADR will establish controlled learning and define how LLM-derived knowledge candidates are validated.
* A future ADR will establish discovery-before-asking behavior.
* A future ADR will define the semantic UI representation used before AI analysis.

## 12. Implementation Notes

The detailed Rule Engine design does not belong in this ADR.

It will be defined in the Knowledge Layer specifications and should include:

* rule schemas
* rule types
* applicability evaluation
* scope resolution
* priority and precedence
* conflict detection
* execution results
* evidence generation
* caching
* performance requirements
* rule lifecycle
* test strategy

This ADR defines the architectural order and authority boundaries. It does not prescribe a specific rules framework, programming language, storage engine, or expression syntax.
