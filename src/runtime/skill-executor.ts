import type { AgentRunExecutor, AgentRunExecutorInput, AgentRunExecutorResult } from "./executor.js";
import type { AgentRunFailure, AgentRunFailureClass, AgentRunFailureCode } from "./public.js";
import type { Skill, SkillInvocation, SkillResultFailureClass, SkillValidationFailureReason } from "../skills/public.js";

export interface Clock {
  now(): Date;
}

/**
 * SPEC-410 (Agent Runner Component): "resolve and pin definitions...
 * assemble minimal context and execute the governed loop from SPEC-309...
 * invoke Skills through SPEC-509" (§2). `src/runtime/executor.ts` is only
 * the `AgentRunExecutor` seam `InMemoryAgentRuntime` calls into — nothing
 * implemented it. This is the tracer-bullet implementer: match exactly one
 * declared Skill against the run's purpose/input (SPEC-509 `Skill.match`),
 * validate and invoke it once (`Skill.validate`/`Skill.invoke`), and map
 * its `SkillResult` into the `AgentRunExecutorValue` the runtime expects —
 * Plan (match) → Act (invoke) → Observe/Validate (map result) collapsed
 * into a single pass. Multi-step/multi-iteration loops, Tool orchestration
 * beyond what a Skill's own `tool_intents` report, and multi-Skill
 * selection beyond "take the first declared Skill" are out of scope here.
 */
export class SkillAgentRunExecutor implements AgentRunExecutor {
  readonly #skills: ReadonlyMap<string, Skill>;
  readonly #clock: Clock;

  constructor(skills: ReadonlyMap<string, Skill>, clock: Clock) {
    this.#skills = skills;
    this.#clock = clock;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const declaredSkills = input.start_request.allowed_skills ?? [];
    const firstDeclared = declaredSkills[0];
    if (firstDeclared === undefined) {
      return runFailure("orchestration", "invalid_definition", "No allowed_skills declared for this run.", false, []);
    }

    const skillKey = `${firstDeclared.id}@${firstDeclared.version}`;
    const skill = this.#skills.get(skillKey);
    if (skill === undefined) {
      return runFailure("orchestration", "invalid_definition", `No resolved Skill for "${skillKey}".`, false, []);
    }

    const match = await skill.match({
      workspace: input.start_request.workspace_context,
      purpose: input.start_request.purpose,
      facts: input.start_request.input,
    });
    if (!match.matched || match.requires_human_selection) {
      return runFailure(
        "orchestration",
        "invalid_definition",
        match.requires_human_selection
          ? `Skill "${skillKey}" requires human selection; no Skill can be committed automatically.`
          : `Skill "${skillKey}" did not match this run's purpose and facts.`,
        false,
        [...match.negative_evidence],
      );
    }

    if (input.signal.aborted) {
      return runFailure("orchestration", "cancelled", "The run was cancelled before Skill invocation.", false, []);
    }

    const invocation: SkillInvocation = {
      skill: firstDeclared,
      operation_id: input.start_request.operation_id,
      run_id: input.reference.run_id,
      workspace: input.start_request.workspace_context,
      input: input.start_request.input,
      authorized_context_refs: [],
      tool_capabilities: (input.start_request.allowed_tools ?? []).map((tool) => `${tool.id}@${tool.version}`),
      policy_version: input.start_request.policy_version,
      limits: { max_duration_seconds: input.start_request.budgets.max_duration_seconds },
      idempotency_key: input.start_request.idempotency_key,
    };

    const validation = await skill.validate(invocation);
    if (!validation.valid) {
      const reason = validation.reasons[0];
      return runFailure(
        validationFailureClass(reason),
        validationFailureCode(reason),
        `Skill "${skillKey}" failed precondition validation: ${validation.reasons.join(", ")}.`,
        false,
        [],
      );
    }

    if (input.signal.aborted) {
      return runFailure("orchestration", "cancelled", "The run was cancelled before Skill invocation.", false, []);
    }

    const result = await skill.invoke(invocation);
    if (!result.ok) {
      return runFailure(
        skillFailureClass(result.failure.class),
        skillFailureCode(result.failure.class),
        result.failure.message,
        result.failure.retryable,
        result.failure.evidence,
      );
    }

    const toolUsage = result.value.tool_intents.filter((intent) => intent.invoked).map((intent) => `${intent.tool.id}@${intent.tool.version}`);
    return {
      ok: true,
      value: {
        output: result.value.output,
        output_validated: true,
        satisfied_evidence_requirements: result.value.postconditions_satisfied,
        resolved_versions: { skill: skillKey },
        rule_results: [],
        skill_usage: [skillKey],
        tool_usage: toolUsage,
        citations: [],
        uncertainty: result.value.uncertainty,
        policy_events: [],
        usage: {
          steps: 1,
          duration_seconds: result.value.usage.duration_seconds,
          tool_calls: result.value.usage.tool_calls ?? toolUsage.length,
          retries: 0,
          ...(result.value.usage.tokens !== undefined ? { tokens: result.value.usage.tokens } : {}),
        },
        evidence: result.value.evidence,
        cleanup_status: "completed",
        knowledge_candidates: [],
      },
    };
  }
}

function validationFailureClass(reason: SkillValidationFailureReason | undefined): AgentRunFailureClass {
  switch (reason) {
    case "missing_required_permission":
      return "policy";
    case "unresolved_dependency":
      return "infrastructure";
    case "budget_exceeds_declared_limits":
      return "policy";
    case "unknown_skill_version":
    case "invalid_input":
    case undefined:
      return "subject";
  }
}

function validationFailureCode(reason: SkillValidationFailureReason | undefined): AgentRunFailureCode {
  switch (reason) {
    case "unknown_skill_version":
      return "invalid_definition";
    case "missing_required_permission":
      return "authorization_denied";
    case "unresolved_dependency":
      return "incompatible_version";
    case "budget_exceeds_declared_limits":
      return "budget_exhausted";
    case "invalid_input":
    case undefined:
      return "invalid_request";
  }
}

function skillFailureClass(failureClass: SkillResultFailureClass): AgentRunFailureClass {
  switch (failureClass) {
    case "precondition":
      return "subject";
    case "authorization":
      return "policy";
    case "input":
      return "subject";
    case "dependency":
      return "infrastructure";
    case "provider":
      return "provider";
    case "tool":
      return "tool";
    case "budget_exhausted":
      return "policy";
    case "cancelled":
      return "orchestration";
  }
}

function skillFailureCode(failureClass: SkillResultFailureClass): AgentRunFailureCode {
  switch (failureClass) {
    case "precondition":
      return "invalid_definition";
    case "authorization":
      return "authorization_denied";
    case "input":
      return "invalid_request";
    case "dependency":
      return "infrastructure_failure";
    case "provider":
      return "provider_failure";
    case "tool":
      return "tool_failure";
    case "budget_exhausted":
      return "budget_exhausted";
    case "cancelled":
      return "cancelled";
  }
}

function runFailure(
  failureClass: AgentRunFailureClass,
  code: AgentRunFailureCode,
  message: string,
  retryable: boolean,
  evidence: readonly string[],
): AgentRunExecutorResult {
  const failure: AgentRunFailure = { class: failureClass, code, message, retryable, evidence };
  return { ok: false, failure };
}
