/**
 * Expert facade: optional domain pack bootstrap + full run_auto_qa pipeline
 * in one MCP tool so hosts need not chain bootstrap → run_auto_qa manually.
 */
import { assessDomainPackGate } from "../domain-pack/assess-domain-pack-gate.js";
import { bootstrapDomainPack } from "../domain-pack/bootstrap-domain-pack.js";
import {
  expertChecklistFromQaRunReport,
  type DomainPackGateInput,
} from "../reporting/expert-checklist.js";
import type { QaRunReport } from "../reporting/qa-run-report.js";
import type { JsonObject, JsonValue, VersionReference } from "../requirement-review/public.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";
import type { RunAutoQaPipelineRuntimeExecutor } from "./run-auto-qa-pipeline-runtime-executor.js";

export type RunExpertQaRuntimeExecutorDependencies = Readonly<{
  autoQa: RunAutoQaPipelineRuntimeExecutor;
  expected_agent: VersionReference;
  expected_skill: VersionReference;
  auto_qa_agent: VersionReference;
  auto_qa_skill: VersionReference;
}>;

export class RunExpertQaRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: RunExpertQaRuntimeExecutorDependencies;

  constructor(dependencies: RunExpertQaRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const productRoot = readString(input.start_request.input["product_root"]);
    const packDirnameRaw = readString(input.start_request.input["pack_dirname"]);
    const pack_dirname =
      packDirnameRaw === ".qa-domain" ? (".qa-domain" as const) : ("domain-knowledge" as const);

    let domainPack: JsonObject;
    let bootstrapNotes: string[] = [];
    if (productRoot !== undefined) {
      const requestContext =
        readString(input.start_request.input["request_context"]) ??
        buildRequestContext(input.start_request.input);
      const result = bootstrapDomainPack({
        product_root: productRoot,
        ...(requestContext !== undefined ? { request_context: requestContext } : {}),
        pack_dirname,
      });
      if (!result.ok) {
        domainPack = { ok: false, message: result.message };
      } else {
        bootstrapNotes = [...result.notes];
        domainPack = {
          ok: true,
          pack_path: result.pack_path,
          created: result.created,
          updated_files: [...result.updated_files],
          notes: [...result.notes],
        };
      }
    } else {
      domainPack = {
        ok: false,
        skipped: true,
        reason: "product_root_absent",
        message: "Pass absolute product_root to auto-bootstrap domain-knowledge/ in this call.",
      };
    }

    const domainGate: DomainPackGateInput = assessDomainPackGate({
      ...(productRoot !== undefined ? { product_root: productRoot } : {}),
      pack_dirname,
      acknowledge_domain_pack_absent: input.start_request.input["acknowledge_domain_pack_absent"] === true,
      domain_high_risk_confirmed: input.start_request.input["domain_high_risk_confirmed"] === true,
      bootstrap_notes: bootstrapNotes,
    });

    const innerInput: AgentRunExecutorInput = {
      ...input,
      start_request: {
        ...input.start_request,
        agent: this.#dependencies.auto_qa_agent,
        allowed_skills: [this.#dependencies.auto_qa_skill],
        purpose: input.start_request.purpose,
        input: {
          ...input.start_request.input,
          ...(productRoot !== undefined ? { product_root: productRoot } : {}),
          ...(input.start_request.input["acknowledge_domain_pack_absent"] === true
            ? { acknowledge_domain_pack_absent: true }
            : {}),
          ...(input.start_request.input["domain_high_risk_confirmed"] === true
            ? { domain_high_risk_confirmed: true }
            : {}),
        },
      },
    };

    const autoResult = await this.#dependencies.autoQa.execute(innerInput);
    if (!autoResult.ok) return autoResult;

    const autoOutput = autoResult.value.output as JsonObject;
    const reinforcedChecklist = reinforceChecklist(autoOutput, domainGate);

    const output = {
      ...autoOutput,
      domain_pack: domainPack,
      domain_pack_gate: {
        present: domainGate.present,
        high_risk_unconfirmed: domainGate.high_risk_unconfirmed,
        ...(domainGate.pack_path !== undefined ? { pack_path: domainGate.pack_path } : {}),
        ...(domainGate.notes !== undefined ? { notes: [...domainGate.notes] } : {}),
      },
      expert_checklist: reinforcedChecklist,
      expert_facade: {
        tool: "run_expert_qa",
        wrapped: ["bootstrap_domain_pack?", "run_auto_qa"],
        note: "Honor expert_checklist + call validate_expert_claim before any pass/ready/ship wording.",
      },
    };

    return {
      ok: true,
      value: {
        ...autoResult.value,
        output,
        resolved_versions: {
          ...autoResult.value.resolved_versions,
          agent: `${this.#dependencies.expected_agent.id}@${this.#dependencies.expected_agent.version}`,
          skill: `${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`,
        },
        skill_usage: [
          `${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`,
          ...autoResult.value.skill_usage,
        ],
        citations: [
          ...autoResult.value.citations,
          ...(typeof domainPack["pack_path"] === "string" ? [`pack:${domainPack["pack_path"]}`] : []),
          `claim_pass_allowed:${reinforcedChecklist["claim_pass_allowed"] === true}`,
        ],
        uncertainty: {
          level:
            reinforcedChecklist["claim_pass_allowed"] === true
              ? autoResult.value.uncertainty.level
              : "high",
          reasons: [
            ...autoResult.value.uncertainty.reasons,
            ...(reinforcedChecklist["claim_pass_allowed"] === true
              ? []
              : ["claim_pass_allowed=false — host must not green-wash; see expert_checklist.blockers"]),
          ],
        },
      },
    };
  }
}

function reinforceChecklist(autoOutput: JsonObject, domainGate: DomainPackGateInput): JsonObject {
  const reportLike = autoOutput as unknown as QaRunReport & {
    coverage_gaps?: unknown[];
    smart_retest_suggestion?: { action?: string };
    auto_registered_suite?: { suite_id?: string } | null;
  };
  const gaps = Array.isArray(autoOutput["coverage_gaps"]) ? autoOutput["coverage_gaps"] : [];
  const retest = autoOutput["smart_retest_suggestion"];
  const action =
    typeof retest === "object" && retest !== null && !Array.isArray(retest)
      ? String((retest as JsonObject)["action"] ?? "unknown")
      : "unknown";
  const suite = autoOutput["auto_registered_suite"];
  const suitePresent =
    typeof suite === "object" && suite !== null && !Array.isArray(suite) && typeof (suite as JsonObject)["suite_id"] === "string";

  const priorChecklist = autoOutput["expert_checklist"];
  const e2FromPrior =
    typeof priorChecklist === "object" &&
    priorChecklist !== null &&
    !Array.isArray(priorChecklist) &&
    Array.isArray((priorChecklist as JsonObject)["blockers"])
      ? ((priorChecklist as JsonObject)["blockers"] as unknown[])
          .map(String)
          .filter((b) => b.startsWith("e2_"))
      : [];

  if (
    typeof reportLike.release_recommendation === "string" &&
    typeof reportLike.release_recommendation_rationale === "string" &&
    Array.isArray(reportLike.test_cases) &&
    typeof reportLike.summary === "object" &&
    reportLike.summary !== null
  ) {
    return expertChecklistFromQaRunReport(reportLike, gaps.length, action, {
      suiteIdPresent: suitePresent,
      domainPack: domainGate,
      ...(e2FromPrior.length > 0 ? { e2MandateBlockers: e2FromPrior } : {}),
      context: "run_expert_qa",
    });
  }

  return (autoOutput["expert_checklist"] as JsonObject) ?? {};
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: RunExpertQaRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  if (
    input.start_request.agent.id !== dependencies.expected_agent.id ||
    input.start_request.agent.version !== dependencies.expected_agent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported by run_expert_qa.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (
    !allowed.some(
      (skill) =>
        skill.id === dependencies.expected_skill.id && skill.version === dependencies.expected_skill.version,
    )
  ) {
    return failure("policy", "authorization_denied", "run_expert_qa skill not present in retained Skill authority.");
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function buildRequestContext(input: Readonly<Record<string, JsonValue | undefined>>): string | undefined {
  const parts: string[] = [];
  const url = readString(input["url"]);
  if (url !== undefined) parts.push(`URL: ${url}`);
  const title = readString(input["requirement_title"]);
  if (title !== undefined) parts.push(`Title: ${title}`);
  const ac = input["acceptance_criteria"];
  if (Array.isArray(ac)) {
    for (const item of ac.slice(0, 8)) {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        const statement = readString((item as JsonObject)["statement"]);
        if (statement !== undefined) parts.push(`AC: ${statement}`);
      }
    }
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
}
